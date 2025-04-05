/*
 * Continuously scan for HackRF devices, announcing when each appears or disappears
 */

import { DeviceInfo, listDevices, UsbBoardId, visible_hackrfs, scan_hackrfs } from '../lib'

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    for (;;) {
	for await (const device_change of scan_hackrfs()) {
	    if (device_change.added) {
		console.log(`Plugged in: ${device_change.added.serialNumber}`)
	    } else if (device_change.removed) {
		console.log(`Unplugged: ${device_change.removed.serialNumber}`)
	    }
	}

	await timeout(1000);	// Sleep for a second before trying again
    }
    process.exit(0)
}
main()
