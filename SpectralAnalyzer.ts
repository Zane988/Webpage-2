type Bar = {
    value: number;
    peak: number;
};

type BarObject = {
    binLo: number;
    binHi: number;
    freqLo: number;
    freqHi: number;
    recentValues:RecentPeakFinder;
}

enum MathType
{
    Round,
    Floor,
    Ceil,
    Cast
}

class SpectralAnalyzer {
    public minDb: number = -70;
    public maxDb: number = -20;
    public fftN: number = 4096;

    public minFreq: number = 50;
    public maxFreq: number = 22000;

    private audioClip!: AudioBuffer;
    private audioSource!: AudioBufferSourceNode;

    private barCount: number = 0;
    private smoothingTimeConstant: number = 0.8;
    private peakHold: number = 0;
    private _minDb: number = -70;
    private _maxDb: number = -20;
    private _fftN: number = 4096;
    fftN2:number = 2048;

    private htmlAnalyzer: AnalyserNode;
    private bars: Array<BarObject> = [];

    private freqToBin(freq:number, mathType: MathType = MathType.Round)
    {
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

    normalizedB(value:number)
    {
        const maxValue = this.maxDb;
        const minValue = this.minDb;

        return this.clamp((value - minValue) / (maxValue - minValue), 0, 1);
    }

    calcBars(barCount:number, peakHold:number)
    {
        this.bars = [];
        const logStep = (LogHelper.log10(this.maxFreq) - LogHelper.log10(this.minFreq)) / (barCount);
        
        const scaleMin:number = Scaling.freqScaleLog(this.minFreq);
        const scaleMax:number = Scaling.freqScaleLog(this.maxFreq);

        const curScale:number = scaleMin;

        for (let i = 0; i < barCount; i++)
        {
            const curFreq:number = Math.pow(10, Scaling.freqScaleLog(this.minFreq) + (logStep * i));
            const freqLo:number = curFreq;

            const freqHi:number = Math.pow(10, Scaling.freqScaleLog(this.minFreq) + (logStep * (i + 1)));

            const binLo = this.freqToBin(freqLo, MathType.Floor);
            const binHi = this.freqToBin(freqHi);

            this.bars.push(
            {
                binLo: binLo,
                binHi: binHi,
                freqLo: freqLo,
                freqHi: freqHi,
                recentValues: new RecentPeakFinder(this.peakHold)
            });
        }

        if (this.bars[0].freqLo < this.minFreq) 
        {
            this.bars[0].freqLo = this.minFreq;
            this.bars[0].binLo = this.freqToBin(this.minFreq, MathType.Floor);
        }

        if (this.bars[this.bars.length - 1].freqHi > this.maxFreq) 
        {
            this.bars[this.bars.length - 1].freqHi = this.maxFreq;
            this.bars[this.bars.length - 1].binHi = this.freqToBin(this.maxFreq, MathType.Floor);
        }
    }

    clamp(val: number, min: number, max: number): number {
        return val <= min ? min : val >= max ? max : val;
    }
    constructor(audioSource:AudioBufferSourceNode, barCount:number, smoothingTimeConstant:number = 0.8, peakHold:number = 30, audioContext:AudioContext) 
    {
        this.audioSource = audioSource;
        this.audioClip = audioSource.buffer!;
        this.barCount = barCount;
        this.smoothingTimeConstant = smoothingTimeConstant;
        this.peakHold = peakHold;

        this.htmlAnalyzer = audioContext.createAnalyser();
        //this.htmlAnalyzer.fftSize = this.fftN;
        this.htmlAnalyzer.smoothingTimeConstant = smoothingTimeConstant;
        this.audioSource.connect(this.htmlAnalyzer);
        this.fftN2 = this.htmlAnalyzer.fftSize; // NOT divided by 2
        this.calcBars(barCount, peakHold);

        this.calcBars(barCount, peakHold);
console.log("sampleRate:", this.audioClip.sampleRate);
console.log("fftN2:", this.fftN2);
console.log("fftSize:", this.htmlAnalyzer.fftSize);
console.log("bars:", this.bars.map(b => `[${b.binLo}-${b.binHi}] ${b.freqLo.toFixed(0)}hz-${b.freqHi.toFixed(0)}hz`));
    }

    public getLevels(levels?:Array<Bar>):Array<Bar>
    {
        if (!levels) levels = [];

        const amplitudes = new Float32Array(this.htmlAnalyzer.frequencyBinCount);
        this.htmlAnalyzer.getFloatFrequencyData(amplitudes);

        for (let i = 0; i < this.bars.length; i++)
        {
            var bar = this.bars[i];
            var binLo = bar.binLo;
            var binHi = bar.binHi;

            let value: number = this.minDb;

            for (let j = binLo + 1; j < binHi; j++) 
            {
                value = Math.max(value, amplitudes[j | 0]);
            }

            value = this.normalizedB(value);
            bar.recentValues.push(value);
            const recentPeak = bar.recentValues.peak;

            if (levels[i] != null) 
            {
                levels[i].value = value;
                levels[i].peak = recentPeak;
            } 
            else levels.push({value: value, peak: recentPeak});
        }
        return levels;
    }
}

class RecentPeakFinder {
    private buffer:Array<number> = [];
    private bufferIndex:number = 0;
    private _peak:number = 0;

    public get peak():number 
    {
        return this._peak;
    }

    private setPeak(v:number) 
    {
        this._peak = v;
    }

    private _lastValue:number = 0.0;

    public get lastValue():number 
    {
        return this._lastValue;
    }

    public constructor(length:number = 30)
    {
        this.buffer = new Array<number>(length).fill(0);
        this.buffer.length = length;
    }

    public push(value:number) 
    {
        this.buffer[this.bufferIndex] = value;
        if(value > this._peak) this._peak = value;
        else this._peak = Math.max(...this.buffer);
        this.bufferIndex = this.bufferIndex + 1 === this.buffer.length ? 0 : this.bufferIndex + 1;
    }

    private get_lastValue(): number {
        return this.bufferIndex === 0 ? this.buffer[this.buffer.length - 1] : this.buffer[this.bufferIndex - 1];
    }
}

class LogHelper
{
    public static log2(x:number):number
    {
        return Math.log(x) / Math.log(2);
    }


    public static log10(x:number):number
    {
        return Math.log(x) / Math.log(10);
    };
}

class Scaling {

    public static freqScaleMel(freq: number): number {
        return Math.log2(1 + freq / 700);
    }

    public static invFreqScaleMel(x: number): number {
        return 700 * Math.pow(2, x - 1);
    }

    public static freqScaleBark(freq: number): number {
        return (26.81 * freq) / (1960 + freq) - 0.53;
    }

    public static invFreqScaleBark(x: number): number {
        return 1960 / (26.81 / (x + 0.53) - 1);
    }

    public static freqScaleLog(freq: number): number {
        return Math.log10(1 + freq / 1000);
    }

    public static invFreqScaleLog(x: number): number {
        return 1000 * Math.pow(10, x - 1);
    }
}
