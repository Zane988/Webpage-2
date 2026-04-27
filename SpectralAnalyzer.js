"use strict";

// ─── AnalyzerNode2 (unchanged — must stay on main thread, uses Web Audio API) ─

class AnalyzerNode2 {
    #fftSize;
    #dataArray;

    constructor(source, fft = 2048, stc = 0.8) {
        this.context  = source.context;
        this.#fftSize = AnalyzerNode2.#nextPow2(fft);
        this.analyzer = this.context.createAnalyser();

        this.analyzer.fftSize               = this.#fftSize;
        this.analyzer.minDecibels           = -70;
        this.analyzer.maxDecibels           = -20;
        this.analyzer.smoothingTimeConstant = stc;

        this.#dataArray = new Float32Array(this.analyzer.frequencyBinCount);
        source.connect(this.analyzer);
    }

    static #nextPow2(n) {
        if (n < 1) return 32;
        let pow = 1;
        while (pow < n) pow <<= 1;
        return Math.min(pow, 32768);
    }

    get fftSize() { return this.#fftSize; }

    getFloatFrequencyData() {
        this.analyzer.getFloatFrequencyData(this.#dataArray);
        return this.#dataArray;
    }
}

// ─── SpectralAnalyzer ─────────────────────────────────────────────────────────
//
//  What moved to the Worker (spectral.worker.js):
//    • calcBars()         — log-scale frequency math, runs once on init
//    • RecentPeakFinder   — rolling peak tracking
//    • processLevels()    — per-frame bin iteration + normalisation
//
//  What stays here (needs Web Audio API / DOM):
//    • AnalyzerNode2 construction
//    • getFloatFrequencyData() call  ← AnalyserNode is main-thread only
//    • Transferring the Float32Array to the worker each frame
//
// ─────────────────────────────────────────────────────────────────────────────

class SpectralAnalyzer {
    minDb    = -70;
    maxDb    = -20;
    minFreq  = 50;
    maxFreq  = 22000;

    // Resolved when the worker signals it is ready
    #ready   = false;
    #worker  = null;

    // Last levels received from the worker (used by draw loop)
    #levels  = [];

    // Pending resolve for one-shot getLevels() callers, if needed
    #onLevels = null;

    /**
     * @param {AudioNode}  audioSource
     * @param {number}     barCount
     * @param {number}     smoothingTimeConstant
     * @param {number}     peakHold
     * @param {number}     fft
     * @param {string}     workerUrl  path to spectral.worker.js
     */
    constructor(
        audioSource,
        barCount,
        smoothingTimeConstant = 0.8,
        peakHold              = 30,
        fft                   = 2048,
        workerUrl             = 'spectral.worker.js'
    ) {
        this.audioSource = audioSource;
        this.audioClip   = audioSource.context;
        this.barCount    = barCount;

        // Web Audio node — must stay on main thread
        this.htmlAnalyzer = new AnalyzerNode2(audioSource, fft, smoothingTimeConstant);

        // Spawn the worker and hand it everything it needs to replicate calcBars
        this.#worker = new Worker(workerUrl);

        this.#worker.onmessage = (e) => this.#handleWorkerMessage(e);

        this.#worker.postMessage({
            type: 'init',
            payload: {
                barCount,
                peakHold,
                minFreq:    this.minFreq,
                maxFreq:    this.maxFreq,
                fftSize:    this.htmlAnalyzer.fftSize / 2,   // frequencyBinCount
                sampleRate: this.audioClip.sampleRate,
                minDb:      this.minDb,
                maxDb:      this.maxDb,
            }
        });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    #handleWorkerMessage({ data }) {
        if (data.type === 'ready') {
            this.#ready = true;
            return;
        }
        if (data.type === 'levels') {
            this.#levels = data.levels;
            if (this.#onLevels) {
                this.#onLevels(this.#levels);
                this.#onLevels = null;
            }
        }
    }

    /**
     * Send the current frequency snapshot to the worker for processing.
     * Non-blocking — results arrive in the next worker message.
     *
     * Call this every animation frame (replaces the old getLevels() loop).
     */
    sendFrame() {
        if (!this.#ready) return;

        // Get raw data from the AnalyserNode (main thread only)
        const src = this.htmlAnalyzer.getFloatFrequencyData();

        // Copy into a new buffer so we can transfer ownership to the worker
        // (zero-copy transfer — no serialisation cost)
        const copy = new Float32Array(src);
        this.#worker.postMessage(
            { type: 'process', payload: { data: copy } },
            [copy.buffer]   // transfer ownership
        );
    }

    /**
     * Returns the most recently computed levels array synchronously.
     * Call sendFrame() first each frame, then read this on the NEXT frame
     * (or whenever the worker has responded).
     *
     * Each entry: { value: number [0-1], peak: number [0-1] }
     */
    getLevels() {
        return this.#levels;
    }

    /**
     * Convenience: update minFreq / maxFreq after construction.
     * Reinitialises the worker bars.
     */
    updateFreqRange(minFreq, maxFreq) {
        this.minFreq = minFreq;
        this.maxFreq = maxFreq;
        if (this.#ready) {
            this.#ready = false;
            this.#worker.postMessage({
                type: 'init',
                payload: {
                    barCount:   this.barCount,
                    peakHold:   0,   // reset — caller can store peakHold if needed
                    minFreq,
                    maxFreq,
                    fftSize:    this.htmlAnalyzer.fftSize / 2,
                    sampleRate: this.audioClip.sampleRate,
                    minDb:      this.minDb,
                    maxDb:      this.maxDb,
                }
            });
        }
    }

    terminate() {
        this.#worker.terminate();
    }
}