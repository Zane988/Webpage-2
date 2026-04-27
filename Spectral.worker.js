"use strict";

// ─── Helpers (copied from SpectralAnalyzer, no DOM needed) ───────────────────

class RecentPeakFinder {
    constructor(length = 30) {
        this.buffer = new Float32Array(length);
        this.length = length;
        this.bufferIndex = 0;
        this._peak = 0;
    }
    push(value) {
        const oldValue = this.buffer[this.bufferIndex];
        this.buffer[this.bufferIndex] = value;
        if (value >= this._peak) {
            this._peak = value;
        } else if (oldValue === this._peak) {
            let max = 0;
            for (let i = 0; i < this.length; i++) {
                if (this.buffer[i] > max) max = this.buffer[i];
            }
            this._peak = max;
        }
        this.bufferIndex = (this.bufferIndex + 1) % this.length;
    }
    get peak() { return this._peak; }
}

class LogHelper {
    static log10(x) { return Math.log(x) / Math.log(10); }
}

class Scaling {
    static freqScaleLog(freq)    { return LogHelper.log10(1 + freq / 1000); }
    static invFreqScaleLog(x)    { return 1000 * (Math.pow(10, x) - 1); }
}

// ─── Worker State ─────────────────────────────────────────────────────────────

let bars      = [];   // computed once in "init"
let minDb     = -70;
let maxDb     = -20;
let fftN2     = 2048;

// ─── Pure functions ───────────────────────────────────────────────────────────

function freqToBin(freq, mode, fftSize, sampleRate) {
    const bin = freq * fftSize / sampleRate;
    if (mode === 'floor') return Math.floor(bin);
    if (mode === 'ceil')  return Math.ceil(bin);
    return Math.round(bin);
}

function normalizedB(value) {
    return Math.min(1, Math.max(0, (value - minDb) / (maxDb - minDb)));
}

/**
 * calcBars — runs once on "init", builds the bar descriptors
 */
function calcBars(barCount, peakHold, minFreq, maxFreq, fftSize, sampleRate) {
    const result = [];
    const logStep = (Scaling.freqScaleLog(maxFreq) - Scaling.freqScaleLog(minFreq)) / barCount;

    for (let i = 0; i < barCount; i++) {
        const freqLo = Scaling.invFreqScaleLog(Scaling.freqScaleLog(minFreq) + logStep * i);
        const freqHi = Scaling.invFreqScaleLog(Scaling.freqScaleLog(minFreq) + logStep * (i + 1));
        result.push({
            binLo:        freqToBin(freqLo, 'floor', fftSize, sampleRate),
            binHi:        freqToBin(freqHi, 'round', fftSize, sampleRate),
            freqLo,
            freqHi,
            recentValues: new RecentPeakFinder(peakHold)
        });
    }

    // clamp edges
    if (result[0].freqLo < minFreq) {
        result[0].freqLo = minFreq;
        result[0].binLo  = freqToBin(minFreq, 'floor', fftSize, sampleRate);
    }
    const last = result[result.length - 1];
    if (last.freqHi > maxFreq) {
        last.freqHi = maxFreq;
        last.binHi  = freqToBin(maxFreq, 'round', fftSize, sampleRate);
    }

    return result;
}

/**
 * processLevels — called every frame with the raw Float32Array from the main thread
 * Returns a plain array of {value, peak} objects (transferable-friendly)
 */
function processLevels(amplitudes) {
    const levels = [];
    for (let i = 0; i < bars.length; i++) {
        const bar   = bars[i];
        let   value = minDb;

        for (let j = bar.binLo; j <= bar.binHi; j++) {
            const s = amplitudes[j | 0];
            if (isFinite(s)) value = Math.max(value, s);
        }

        value = normalizedB(value);
        bar.recentValues.push(value);

        levels.push({ value, peak: bar.recentValues.peak });
    }
    return levels;
}

// ─── Message Handler ──────────────────────────────────────────────────────────

self.onmessage = function (e) {
    const { type, payload } = e.data;

    switch (type) {

        // Sent once after SpectralAnalyzer is constructed on the main thread
        case 'init': {
            minDb  = payload.minDb;
            maxDb  = payload.maxDb;
            fftN2  = payload.fftSize;

            bars = calcBars(
                payload.barCount,
                payload.peakHold,
                payload.minFreq,
                payload.maxFreq,
                payload.fftSize,
                payload.sampleRate
            );

            self.postMessage({ type: 'ready', barCount: bars.length });
            break;
        }

        // Sent every animation frame with raw frequency data
        case 'process': {
            // payload.data is a Float32Array transferred from the main thread
            const levels = processLevels(payload.data);
            self.postMessage({ type: 'levels', levels });
            break;
        }
    }
};