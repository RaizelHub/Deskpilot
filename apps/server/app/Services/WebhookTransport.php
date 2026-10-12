<?php

namespace App\Services;

class WebhookTransport
{
    public function send(string $url, string $body, array $headers): array
    {
        $target = app(WebhookUrlPolicy::class)->resolve($url);
        $curl = curl_init();
        $bytes = 0;
        curl_setopt_array($curl, [CURLOPT_URL => $url, CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers, CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_PROXY => '', CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_RESOLVE => [$target['host'].':'.$target['port'].':'.$target['ip']], CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | ($target['local'] ? CURLPROTO_HTTP : 0), CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$bytes) {
            $bytes += strlen($chunk);

            return $bytes > 65536 ? 0 : strlen($chunk);
        }]);
        try {
            $ok = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);

            return ['status' => $status, 'error' => $ok === false ? 'transport_error' : null];
        } finally {
            curl_close($curl);
        }
    }
}
