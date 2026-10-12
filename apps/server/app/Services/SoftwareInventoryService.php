<?php

namespace App\Services;

use App\Models\Device;
use App\Models\InstalledSoftware;

class SoftwareInventoryService
{
    // Called inside the device signature middleware's locked transaction.
    public function ingest(Device $device, array $report): void
    {
        $received = now();
        $keys = [];
        foreach ($report['applications'] as $application) {
            $keys[] = $application['source_key'];
            $row = InstalledSoftware::firstOrNew(['device_id' => $device->id, 'source_key' => $application['source_key']]);
            if (! $row->exists) {
                $row->first_detected_at = $received;
            }
            $row->fill([...$application, 'last_detected_at' => $received, 'removed_at' => null])->save();
        }
        if ($report['complete']) {
            InstalledSoftware::where('device_id', $device->id)->whereNull('removed_at')->whereNotIn('source_key', $keys)->update(['removed_at' => $received]);
        }
        $device->update(['software_inventory_at' => $received, 'software_inventory_complete' => $report['complete']]);
    }
}
