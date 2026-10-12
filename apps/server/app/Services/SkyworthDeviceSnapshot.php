<?php

namespace App\Services;

use InvalidArgumentException;

/** Parses saved GN630V responses as data; never executes router JavaScript. */
class SkyworthDeviceSnapshot
{
    public function parse(string $html): array
    {
        if (strlen($html) > 1048576 || ! mb_check_encoding($html, 'UTF-8')) {
            throw new InvalidArgumentException('The router response must be UTF-8 and at most 1 MiB.');
        }

        $devices = [];
        $seen = [];
        foreach (['result_lan' => 'wired', 'result_Wifi' => 'wifi'] as $variable => $connection) {
            $rows = $this->readArray($html, $variable);
            if (count($rows) > 512) {
                throw new InvalidArgumentException('Too many router device records.');
            }
            foreach ($rows as $row) {
                if (! is_array($row)) {
                    throw new InvalidArgumentException('Invalid router device record.');
                }
                foreach (['MACAddress', 'HostName', 'IPAddressV4', 'Port', 'ConnectTime', 'status'] as $field) {
                    if (! isset($row[$field]) || ! is_string($row[$field]) || strlen($row[$field]) > 255 || preg_match('/[\x00-\x1f\x7f]/', $row[$field])) {
                        throw new InvalidArgumentException('Invalid router device field.');
                    }
                }
                $mac = strtolower($row['MACAddress']);
                if (! preg_match('/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/D', $mac)
                    || (hexdec(substr($mac, 0, 2)) & 1) !== 0 || $mac === '00:00:00:00:00:00'
                    || isset($seen[$mac])
                    || ! in_array($row['status'], ['online', 'offline'], true)
                    || ($row['IPAddressV4'] !== '' && filter_var($row['IPAddressV4'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false)
                    || ! in_array($row['Port'], $connection === 'wifi' ? ['2.4G', '5G'] : ['LAN1', 'LAN2', 'LAN3', 'LAN4'], true)) {
                    throw new InvalidArgumentException('Unsupported or inconsistent router device data.');
                }
                $seen[$mac] = true;
                $devices[] = [
                    'name' => $row['HostName'],
                    'mac_address' => $mac,
                    'ip_address' => $row['IPAddressV4'],
                    'connection' => $connection,
                    'port' => $row['Port'],
                    'router_status' => $row['status'],
                    // Router clock/timezone is unverified; do not convert to UTC.
                    'router_connection_time' => $row['ConnectTime'],
                    'health' => 'unknown',
                ];
            }
        }

        return ['source' => 'skyworth_gn630v_saved_response', 'live' => false, 'devices' => $devices];
    }

    private function readArray(string $html, string $variable): array
    {
        if (preg_match_all('/\bvar\s+'.preg_quote($variable, '/').'\s*=\s*/', $html, $matches, PREG_OFFSET_CAPTURE) !== 1) {
            throw new InvalidArgumentException('Missing or ambiguous router device list.');
        }
        [$assignment, $offset] = $matches[0][0];
        $start = $offset + strlen($assignment);
        if (($html[$start] ?? '') !== '[') {
            throw new InvalidArgumentException('The router device list is not a JSON array.');
        }
        $depth = 0;
        $quoted = false;
        $escaped = false;
        for ($i = $start; $i < strlen($html); $i++) {
            $char = $html[$i];
            if ($quoted) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === '"') {
                    $quoted = false;
                }

                continue;
            }
            if ($char === '"') {
                $quoted = true;
            } elseif ($char === '[') {
                $depth++;
            } elseif ($char === ']' && --$depth === 0) {
                if (! str_starts_with(ltrim(substr($html, $i + 1)), ';')) {
                    break;
                }
                try {
                    $value = json_decode(substr($html, $start, $i - $start + 1), true, 16, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    break;
                }
                if (is_array($value) && array_is_list($value)) {
                    return $value;
                }
                break;
            }
        }
        throw new InvalidArgumentException('Malformed router device list.');
    }
}
