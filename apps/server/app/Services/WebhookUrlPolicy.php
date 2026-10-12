<?php

namespace App\Services;

class WebhookUrlPolicy
{
    public function validate(string $url): array
    {
        $p = parse_url($url);
        $host = strtolower($p['host'] ?? '');
        $port = $p['port'] ?? 443;
        $local = app()->environment('local', 'testing') && config('deskpilot.webhook_allow_loopback_http') && $host === '127.0.0.1' && ($p['scheme'] ?? '') === 'http' && isset($p['port']) && $port >= 1024 && $port <= 65535;
        if (! filter_var($url, FILTER_VALIDATE_URL) || preg_match('/[\x00-\x20\\\\]/', $url) || isset($p['user']) || isset($p['pass']) || isset($p['fragment']) || isset($p['query']) || (! $local && (($p['scheme'] ?? '') !== 'https' || $port !== 443)) || ! preg_match('/^[a-z0-9.-]+$/', $host)) {
            throw new \InvalidArgumentException('Use an HTTPS URL on port 443 without credentials, query or fragment.');
        }
        if (! $local && filter_var($host, FILTER_VALIDATE_IP) && ! $this->publicIp($host)) {
            throw new \InvalidArgumentException('Webhook destinations must use globally routable IPv4 addresses.');
        }
        if (! $local && ! filter_var($host, FILTER_VALIDATE_IP) && (! str_contains($host, '.') || preg_match('/^[0-9.]+$/', $host) || str_ends_with($host, '.'))) {
            throw new \InvalidArgumentException('Use a public DNS hostname.');
        }

        return ['host' => $host, 'port' => $port, 'local' => $local];
    }

    private function publicIp(string $ip): bool
    {
        return (bool) filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_GLOBAL_RANGE) && ((int) explode('.', $ip)[0] < 224);
    }

    public function addresses(string $host): array
    {
        $records = @dns_get_record($host, DNS_A);

        return array_values(array_unique(array_column($records ?: [], 'ip')));
    }

    public function resolve(string $url): array
    {
        $p = $this->validate($url);
        $ips = filter_var($p['host'], FILTER_VALIDATE_IP) ? [$p['host']] : $this->addresses($p['host']);
        if (! $ips) {
            throw new \RuntimeException('dns_unavailable');
        }foreach ($ips as $ip) {
            if (! $p['local'] && ! $this->publicIp($ip)) {
                throw new \InvalidArgumentException('destination_blocked');
            }
        }

return [...$p, 'ip' => $ips[0]];
    }
}
