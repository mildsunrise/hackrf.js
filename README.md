# hackrf.js

JS port of [libhackrf][] using [usb][usb]. This module allows you to control HackRF devices (i.e. HackRF One, Jawbreaker, Rad1o) from Node.js.

Keep in mind this is mostly a direct API to the USB interface, so it's low level.

~~~ bash
npm install hackrf.js
~~~

**[💡 Examples](./examples)** &nbsp;•&nbsp; **[📚 API reference][api]**


## Usage

Use [`listDevices`][] to list HackRF devices, or [`open`][] to open the first device:

~~~ js
import { listDevices, open, UsbBoardId } from 'hackrf.js'

for await (const info of listDevices()) {
    console.log(`Found ${UsbBoardId[info.usbBoardId]}`)
    console.log(`Serial: ${info.serialNumber}`)
}

const device = await open()
~~~

To select among multiple devices, [`open`][] can take a serial number or suffix:

~~~ js
const device = await open('41fa')
~~~

If successful, a [`HackrfDevice`][] instance is returned.
Then you'd usually configure the parameters:

~~~ js
await device.setSampleRate(20e6)  // 20 Msps
await device.setFrequency(2451e6) // tune to 2.451 GHz
await device.setAmpEnable(false)  // RF amplifier = off
// for RX only
await device.setLnaGain(8)        // IF gain = 8dB
await device.setVgaGain(12)       // BB gain = 12dB
// for TX only
await device.setTxVgaGain(8)      // IF gain = 8dB
~~~

Finally, use [`receive`][], [`sweepReceive`][] or [`transmit`][] to start streaming I/Q samples. These methods accept a callback that receives an `Int8Array` to fill (TX) or read (RX):

~~~ js
await device.receive(array => {
    // TODO: Process the samples in `array`
    // - Every 2 items form an I/Q sample
    // - int8 means the range is -128 to +127
})
~~~

The array's buffer may be reused (overwritten) later, so avoid storing any references to it. Instead, copy the data somewhere else.
To request ending the stream, return `false` from the callback (or call `device.requestStop()` which has the same effect).

If you no longer need the device, you must call `device.close()` to release it (the GC will not do this automatically). This is not needed if the process is going to exit.

See the [reference][api] for the full API.



[usb]: https://www.npmjs.com/package/usb
[libhackrf]: https://github.com/mossmann/hackrf/tree/master/host
[node-hackrf]: https://www.npmjs.com/package/hackrf

[api]: https://hackrf.alba.sh/docs/globals.html
[`listDevices`]: https://hackrf.alba.sh/docs/globals.html#open
[`open`]: https://hackrf.alba.sh/docs/globals.html#open
[`HackrfDevice`]: https://hackrf.alba.sh/docs/classes/hackrfdevice.html
[`receive`]: https://hackrf.alba.sh/docs/classes/hackrfdevice.html#receive
[`sweepReceive`]: https://hackrf.alba.sh/docs/classes/hackrfdevice.html#sweepReceive
[`transmit`]: https://hackrf.alba.sh/docs/classes/hackrfdevice.html#transmit
