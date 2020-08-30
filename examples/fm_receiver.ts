/**
 * Mono FM receiver.
 * 
 * This is a very basic example. It's missing the FM deemphasis
 * filter, and it doesn't reconcile different clock rates
 * (SDR - audio card) but it should be functional.
 */

import { open } from '..'
import Speaker from 'speaker'

async function main() {
	const fs = 1200e3
	const tuneOffset = -120e3
	const carrierFrequency = 98.8e6
	const carrierDeviation = 75e3

	const device = await open()
	await device.setFrequency(carrierFrequency + tuneOffset)
	await device.setSampleRate(fs)
	await device.setAmpEnable(false)
	await device.setLnaGain(24)
	await device.setVgaGain(8)

	// Collect audio samples & play back
	const speaker = new Speaker({ sampleRate: 48000, channels: 1, bitDepth: 16 })
	speaker.cork()
	setTimeout(() => speaker.uncork(), 1000)
	let audioArray = new Int16Array(48000 * .1)
	let bufferFill = 0
	const audioSignal = (x: number) => {
		x *= .7
		audioArray[bufferFill++] = Math.round(x * (2**15 - 1))
		if (bufferFill >= audioArray.length) {
			speaker.write(Buffer.from(audioArray.buffer, audioArray.byteOffset, audioArray.byteLength))
			// we can't touch buffer we've written; allocate a new one
			audioArray = new Int16Array(audioArray.length)
			bufferFill = 0
		}
	}

	// DSP chain
	const audioFilter = makeDecimatingFirF(audioSignal, lowPassTaps(fs/5, 16e3, 5e3, 40), 5)
	const demod = makeFrequencyDemod(fs/5, carrierDeviation)
	const basebandSignal = (x: Complex) => audioFilter(demod(x))

	const channelFilter = makeDecimatingFirC(basebandSignal, lowPassTaps(fs, 75e3, 10e3, 40), 5)
	const shifter = makeShifter(fs, tuneOffset)
	const signal = (x: Complex) => channelFilter(shifter(x))

	console.error(`Receiving at ${(carrierFrequency/1e6).toFixed(2)}MHz...`)
	process.on('SIGINT', () => device.requestStop())
	await device.receive(array => {
		const samples = array.length / 2
		for (let n = 0; n < samples; n++)
			signal([ array[n * 2 + 0] / 127, array[n * 2 + 1] / 127 ])
	})
	speaker.destroy()
	console.error('\nDone, exiting')
}
main()

type Complex = [number, number]
const PI = Math.PI, TAU = PI * 2
const sinc = (x: number) => x !== 0 ? Math.sin(x) / x : 1

const multiply = (a: Complex, b: Complex): Complex =>
	[ a[0]*b[0] - a[1]*b[1], a[1]*b[0] + a[0]*b[1] ]

function makeShifter(fs: number, shiftFrequency: number) {
	const localOscillator = makeToneGeneratorC(fs, shiftFrequency)
	return (x: Complex) => multiply(localOscillator(), x)
}

function makeToneGeneratorC(fs: number, frequency: number, amplitude: number = 1) {
	let phase = 0
	const delta = (TAU * frequency / fs) % TAU
	return (): Complex => {
		phase = (phase + delta) % TAU
		return [ amplitude * Math.cos(phase), amplitude * Math.sin(phase) ]
	}
}

function makeFrequencyDemod(fs: number, maxDeviation: number) {
	let phase = 0
	const iDelta = 1 / (TAU * maxDeviation / fs)
	return (x: Complex): number => {
		const newPhase = Math.atan2(x[1], x[0])
		const diff = newPhase - phase
		phase = newPhase
		return iDelta * ((diff + 3*TAU/2) % TAU - TAU/2)
	}
}

function lowPassTaps(fs: number, cutoffFreq: number, transitionWidth: number, attenuation: number) {
	const window = (x: number) => 0.54 - 0.46 * Math.cos(TAU * x) // hamming window

	let ntaps = Math.floor(attenuation / (22 * transitionWidth / fs))
	if ((ntaps % 2) === 0) ntaps++

	const M = (ntaps - 1) / 2
	const omega = 2 * cutoffFreq / fs
	const taps = [...Array(ntaps)].map((_, n) =>
		window(n / (ntaps - 1)) * omega * sinc(PI * omega * (n - M)) )

	const gain = 1 / taps.reduce((a, b) => a + b)
	return taps.map(x => gain * x)
}

function makeDecimatingFirF(output: (x: number) => void, taps: number[], decimation: number) {
	const hs = Float64Array.from(taps).reverse()
	const xs = new Float64Array(taps.length)
	let start = 0
	let pos = 0
	return (x: number) => {
		xs[start] = x
		start = (start + 1) % taps.length
		pos = (pos + 1) % decimation
		if (pos !== 0) return

		let y = 0
		for (let i = 0; i < taps.length; i++)
			y += hs[i] * xs[(start + i) % taps.length]
		output(y)
	}
}

function makeDecimatingFirC(output: (x: Complex) => void, taps: number[], decimation: number) {
	const hs = Float64Array.from(taps).reverse()
	const xs = new Float64Array(2 * taps.length)
	let start = 0
	let pos = 0
	return (x: Complex) => {
		xs.set(x, start * 2)
		start = (start + 1) % taps.length
		pos = (pos + 1) % decimation
		if (pos !== 0) return

		let y: Complex = [0, 0]
		for (let i = 0; i < taps.length; i++) {
			const idx = 2 * ((start + i) % taps.length)
			y[0] += hs[i] * xs[idx + 0]
			y[1] += hs[i] * xs[idx + 1]
		}
		output(y)
	}
}
