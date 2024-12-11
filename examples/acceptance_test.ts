/*
 * Configure a HackRF as test rig, another as test subject (DUT) and run tests interactively
 */

import { DeviceInfo, listDevices, UsbBoardId, visible_hackrfs, scan_hackrfs } from '../lib'
import { run_test_sequence } from './test_sequence'

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function await_hackrf(device: string) {
    process.stdout.write(`Please connect ${device}: `);
    for (;;) {
	for await (const device_change of scan_hackrfs()) {
	    if (device_change.added) {
		console.log(`\nPlugged in: ${device_change.added.serialNumber}`)
		process.stdout.write("\n");
		return device_change.added;
	    }
	    /* Ignore removals for now
	    else if (device_change.removed) {
		console.log(`Unplugged: ${device_change.removed.serialNumber}`)
		return undefined;
	    }
	    */
	}

	await timeout(1000);	// Sleep for a second before trying again
    }
}

async function await_rig()
{
    // Do the initial scan to see what's connected
    for await (const device_change of scan_hackrfs()) { scan_hackrfs(); }

    while (visible_hackrfs.length > 1) {
	process.stdout.write(`${visible_hackrfs.length} HackRFs connected, unplug all but the test controller please\r`)
	await timeout(1000);	// Sleep for a second before trying again
	for await (const device_change of scan_hackrfs()) { scan_hackrfs(); }
    }

    if (visible_hackrfs.length == 1)
    {
	console.log(`Detected ${visible_hackrfs[0].serialNumber} as test controller`)
	return visible_hackrfs[0];
    }
    return await_hackrf("test controller HackRF");
}

async function await_dut()
{
    return await_hackrf("HackRF to be tested");
}

async function main() {

    var rig = await await_rig();
    for (;;) {
	var dut = await await_dut();
	if (!dut) continue;

	console.log(`Detected ${dut.serialNumber} as DUT`)

	await run_test_sequence(rig, dut)
	break;
    }
    process.exit(0)
}
main()
