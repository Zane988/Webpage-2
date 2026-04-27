"use strict";
var MathType;
(function (MathType) {
    MathType[MathType["Round"] = 0] = "Round";
    MathType[MathType["Floor"] = 1] = "Floor";
    MathType[MathType["Ceil"] = 2] = "Ceil";
    MathType[MathType["Cast"] = 3] = "Cast";
})(MathType || (MathType = {}));
class SpectralAnalyzer {
    minDb = -70;
    maxDb = -20;

    maxDecibels = -30;
    minDecibels = -100;

    fftN = 4096;
    minFreq = 50;
    maxFreq = 22000;
    audioClip;
    audioSource;
    barCount = 0;
    smoothingTimeConstant = 0.0;
    peakHold = 0;
    _minDb = -70;
    _maxDb = -20;
    _fftN = 4096;
    fftN2 = 2048;
    htmlAnalyzer;
    bars = [];
    freqToBin(freq, mathType = MathType.Round) {
        let bin = freq * this.fftN2 / this.audioClip.sampleRate;
        switch (mathType) {
            case MathType.Round:
                return Math.round(bin);
            case MathType.Floor:
                return Math.floor(bin);
            case MathType.Ceil:
                return Math.ceil(bin);
            case MathType.Cast:
                return bin | 0;
        }
    }
    normalizedB(value) {
        const maxValue = this.maxDb;
        const minValue = this.minDb;
        return this.clamp((value - minValue) / (maxValue - minValue), 0, 1);
    }
    calcBars(barCount, peakHold) {
        this.bars = [];

        const logStep = (Scaling.freqScaleLog(this.maxFreq) - Scaling.freqScaleLog(this.minFreq)) / barCount;

        for (let i = 0; i < barCount; i++) {
            const freqLo = Scaling.invFreqScaleLog(Scaling.freqScaleLog(this.minFreq) + (logStep * i));
            const freqHi = Scaling.invFreqScaleLog(Scaling.freqScaleLog(this.minFreq) + (logStep * (i + 1)));

            const binLo = this.freqToBin(freqLo, MathType.Floor);
            const binHi = this.freqToBin(freqHi, MathType.Round);

            this.bars.push({
                binLo: binLo,
                binHi: binHi,
                freqLo: freqLo,
                freqHi: freqHi,
                recentValues: new RecentPeakFinder(peakHold)
            });
        }

        if (this.bars[0].freqLo < this.minFreq) {
            this.bars[0].freqLo = this.minFreq;
            this.bars[0].binLo = this.freqToBin(this.minFreq, MathType.Floor);
        }

        if (this.bars[this.bars.length - 1].freqHi > this.maxFreq) {
            this.bars[this.bars.length - 1].freqHi = this.maxFreq;
            this.bars[this.bars.length - 1].binHi = this.freqToBin(this.maxFreq, MathType.Round);
        }
    }
    clamp(val, min, max) {
        return val <= min ? min : val >= max ? max : val;
    }
    constructor(audioSource, barCount, smoothingTimeConstant = 0.8, peakHold = 30, fft = 2048) {
        this.audioSource = audioSource;
        this.audioClip = audioSource.context;
        this.barCount = barCount;
        this.smoothingTimeConstant = smoothingTimeConstant;
        this.peakHold = peakHold;

        this.htmlAnalyzer = new AnalyzerNode2(audioSource, fft, this.smoothingTimeConstant);
        this.fftN2 = this.htmlAnalyzer.fftSize;
        this.calcBars(barCount, peakHold);

    }
    getLevels(levels) {
        if (!levels)
            levels = [];
        const amplitudes = this.htmlAnalyzer.getFloatFrequencyData();
        
        for (let i = 0; i < this.bars.length; i++) {
            var bar = this.bars[i];
            var binLo = bar.binLo;
            var binHi = bar.binHi;
            let value = this.minDb;
            for (let j = binLo; j <= binHi; j++) {
                const s = amplitudes[j | 0];
                if (isFinite(s)) value = Math.max(value, s);
            }
            value = this.normalizedB(value);
            bar.recentValues.push(value);
            const recentPeak = bar.recentValues.peak;
            if (levels[i] != null) {
                levels[i].value = value;
                levels[i].peak = recentPeak;
            }
            else
                levels.push({ value: value, peak: recentPeak });
        }
        return levels;
    }
}
class RecentPeakFinder {
    buffer = [];
    bufferIndex = 0;
    _peak = 0;
    get peak() {
        return this._peak;
    }
    setPeak(v) {
        this._peak = v;
    }
    _lastValue = 0.0;
    get lastValue() {
        return this._lastValue;
    }
    constructor(length = 30) {
        this.buffer = new Array(length);
        this.buffer.length = length;
    }
    push(value) {
        this.buffer[this.bufferIndex] = value;
        if (value > this._peak)
            this._peak = value;
        else
            this._peak = Signal.max(this.buffer);
        this.bufferIndex = this.bufferIndex + 1 === this.buffer.length ? 0 : this.bufferIndex + 1;
    }
    get_lastValue() {
        return this.bufferIndex === 0 ? this.buffer[this.buffer.length - 1] : this.buffer[this.bufferIndex - 1];
    }
}
class Signal {
    static max(y) {
        return y.reduce((a, b) => Math.max(a, b), y[0]);
    }
}
class LogHelper {
    static log2(x) {
        return Math.log(x) / Math.log(2);
    }
    static log10(x) {
        return Math.log(x) / Math.log(10);
    }
}
class Scaling {
    static freqScaleMel(freq) {
        return LogHelper.log2(1 + freq / 700);
    }
    static invFreqScaleMel(x) {
        return 700 * Math.pow(2, x - 1);
    }
    static freqScaleBark(freq) {
        return (26.81 * freq) / (1960 + freq) - 0.53;
    }
    static invFreqScaleBark(x) {
        return 1960 / (26.81 / (x + 0.53) - 1);
    }
    static freqScaleLog(freq) {
        return LogHelper.log10(1 + freq / 1000);
    }

    static invFreqScaleLog(x) {
        return 1000 * (Math.pow(10, x) - 1);
    }
}

class AnalyzerNode2 {
    #fftSize
    #dataArray

    constructor(source, fft = 2048, stc = 0.8) {
        this.context = source.context;
        this.#fftSize = AnalyzerNode2.#nextPow2(fft);
        this.analyzer = this.context.createAnalyser();

        this.analyzer.fftSize = this.#fftSize;
        this.analyzer.minDecibels = -70;
        this.analyzer.maxDecibels = -20;
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

    get fftSize() {
        return this.#fftSize;
    }

    getFloatFrequencyData() {
        
        
        this.analyzer.getFloatFrequencyData(this.#dataArray);
        return this.#dataArray;
    }
}