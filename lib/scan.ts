/*
 * Continuously scan for HackRF devices, announcing when each appears or disappears
 */

import { DeviceInfo, listDevices, UsbBoardId } from '.'

/*
 * This array contains all the HackRF devices that were visible on the last scan_hackrfs
 */
export var visible_hackrfs: Array<DeviceInfo>;
visible_hackrfs = new Array<DeviceInfo>;

export async function* scan_hackrfs() {
    var disappeared_hackrfs = [...visible_hackrfs];	  // Copy devices that were visible previously
    for await (const extant of listDevices()) {
	var found = visible_hackrfs.find(e => e.usbBoardId == extant.usbBoardId && e.serialNumber == extant.serialNumber)
	if (found) {	// Still present, it's not disappeared
	  disappeared_hackrfs.splice(disappeared_hackrfs.indexOf(found), 1);
	} else {	// New device
	  visible_hackrfs.push(extant);
	  yield({ added: extant });  // New device found
	}
    }
    for (const gone of disappeared_hackrfs) {
	yield({ removed: gone });  // Device unplugged
	visible_hackrfs.splice(visible_hackrfs.indexOf(gone), 1);
    }
}
