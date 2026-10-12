<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\DeviceCredential;
use App\Models\EnrollmentGrant;
use App\Services\Audit;
use App\Services\AutomationEvents;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AgentController extends Controller
{
    public function enroll(Request $request, Audit $audit)
    {
        $d = $request->validate(['token' => 'required|string|size:64', 'public_key' => 'required|string|max:2000', 'hostname' => 'required|string|max:100', 'agent_version' => 'required|string|max:40']);
        $key = @openssl_pkey_get_public($d['public_key']);
        $details = $key ? openssl_pkey_get_details($key) : false;
        if (! $details || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 3072 || $details['bits'] > 4096) {
            throw ValidationException::withMessages(['public_key' => 'Supply an RSA public key of 3072–4096 bits.']);
        }

        return DB::transaction(function () use ($d, $details, $audit) {
            $grant = EnrollmentGrant::where('token_hash', hash('sha256', $d['token']))->lockForUpdate()->first();
            abort_unless($grant && ! $grant->revoked_at && $grant->expires_at->isFuture(), 401, 'Enrollment grant is invalid, expired or revoked.');
            $fingerprint = hash('sha256', $details['key']);
            if ($grant->used_at) {
                $device = Device::find($grant->device_id);
                abort_unless($device && ! $device->revoked_at && hash_equals($device->credential->fingerprint, $fingerprint), 409, 'Enrollment grant has already been used.');

                return response()->json(['device_id' => $device->id, 'heartbeat_seconds' => 60]);
            }
            abort_if(DeviceCredential::where('fingerprint', $fingerprint)->exists(), 409, 'This key is already enrolled.');
            $device = Device::create(['name' => $grant->label, 'hostname' => $d['hostname'], 'department_id' => $grant->department_id, 'agent_version' => $d['agent_version']]);
            $device->credential()->create(['public_key' => $details['key'], 'fingerprint' => $fingerprint]);
            $grant->update(['device_id' => $device->id, 'used_at' => now()]);
            $audit->record('device.enrolled', null, $device, ['grant_id' => $grant->id]);

            return response()->json(['device_id' => $device->id, 'heartbeat_seconds' => 60], 201);
        });
    }

    public function heartbeat(Request $request)
    {
        $d = $request->validate(['agent_version' => 'required|string|max:40', 'cpu_percent' => 'present|nullable|numeric|min:0|max:100', 'ram_available_bytes' => 'present|nullable|integer|min:0|max:9007199254740991', 'uptime_seconds' => 'present|nullable|integer|min:0|max:3153600000', 'network_connected' => 'present|nullable|boolean']);
        $device = $request->attributes->get('device');
        $device->fill($d);
        $device->last_seen_at = now();
        $device->save();
        app(AutomationEvents::class)->device($device);

        return response()->json(['received_at' => now()->toIso8601String(), 'heartbeat_seconds' => 60]);
    }

    public function inventory(Request $request)
    {
        $rules = ['hostname' => 'required|string|max:100', 'hardware' => 'required|array:os_name,os_version,os_build,cpu_name,cpu_cores,ram_total_bytes,manufacturer,model,serial_number,motherboard,gpu,boot_time', 'hardware.cpu_cores' => 'present|nullable|integer|min:1|max:4096', 'hardware.ram_total_bytes' => 'present|nullable|integer|min:0|max:9007199254740991', 'hardware.boot_time' => 'present|nullable|date', 'disks' => 'present|array|max:64', 'disks.*' => 'array:name,file_system,total_bytes,free_bytes', 'disks.*.name' => 'required|string|max:100|distinct', 'disks.*.file_system' => 'nullable|string|max:40', 'disks.*.total_bytes' => 'required|integer|min:0|max:9007199254740991', 'disks.*.free_bytes' => 'required|integer|min:0|lte:disks.*.total_bytes', 'interfaces' => 'present|array|max:64', 'interfaces.*' => 'array:interface_id,name,mac_address,is_up,addresses,gateways,dns_servers', 'interfaces.*.interface_id' => 'required|string|max:100|distinct', 'interfaces.*.name' => 'required|string|max:200', 'interfaces.*.mac_address' => 'nullable|string|max:40', 'interfaces.*.is_up' => 'required|boolean'];
        foreach (['os_name', 'os_version', 'os_build', 'cpu_name', 'manufacturer', 'model', 'serial_number', 'motherboard', 'gpu'] as $field) {
            $rules['hardware.'.$field] = 'present|nullable|string|max:200';
        }
        foreach (['addresses', 'gateways', 'dns_servers'] as $field) {
            $rules['interfaces.*.'.$field] = 'present|array|max:32';
            $rules['interfaces.*.'.$field.'.*'] = 'required|ip';
        }
        $d = $request->validate($rules);
        $device = $request->attributes->get('device');
        $device->hardware()->updateOrCreate(['device_id' => $device->id], $d['hardware']);
        $device->disks()->delete();
        $device->disks()->createMany($d['disks']);
        $device->interfaces()->delete();
        $device->interfaces()->createMany($d['interfaces']);
        $device->hostname = $d['hostname'];
        $device->inventory_at = now();
        $device->save();

        return response()->json(['received_at' => now()->toIso8601String()]);
    }
}
