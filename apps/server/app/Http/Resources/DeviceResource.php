<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeviceResource extends JsonResource
{
    public function toArray(Request $r): array
    {
        return ['software_inventory_at' => $this->software_inventory_at, 'software_inventory_complete' => $this->software_inventory_complete, 'id' => $this->id, 'name' => $this->name, 'hostname' => $this->hostname, 'department_id' => $this->department_id, 'department' => $this->whenLoaded('department'), 'state' => $this->state(), 'agent_version' => $this->agent_version, 'last_seen_at' => $this->last_seen_at, 'inventory_at' => $this->inventory_at, 'created_at' => $this->created_at, 'revoked_at' => $this->revoked_at, 'revocation_reason' => $this->revocation_reason, 'version' => $this->version, 'cpu_percent' => $this->cpu_percent, 'ram_available_bytes' => $this->ram_available_bytes, 'uptime_seconds' => $this->uptime_seconds, 'network_connected' => $this->network_connected, 'hardware' => $this->whenLoaded('hardware'), 'disks' => $this->whenLoaded('disks'), 'interfaces' => $this->whenLoaded('interfaces')];
    }
}
