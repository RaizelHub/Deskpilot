<?php

namespace Tests\Unit;

use App\Services\SkyworthDeviceSnapshot;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class SkyworthDeviceSnapshotTest extends TestCase
{
    private function page(array $wifi = []): string
    {
        return '<script>var result_lan = []; var result_Wifi = '.json_encode($wifi).';</script>';
    }

    private function device(): array
    {
        return ['MACAddress' => '02:AA:BB:CC:DD:EE', 'HostName' => 'Test "]; device', 'IPAddressV4' => '192.168.1.25', 'Port' => '5G', 'ConnectTime' => '2026-10-12T12:00:00', 'status' => 'online'];
    }

    public function test_reads_data_without_confusing_presence_with_health_or_live_state(): void
    {
        $snapshot = (new SkyworthDeviceSnapshot)->parse($this->page([$this->device()]));
        $this->assertFalse($snapshot['live']);
        $this->assertSame('unknown', $snapshot['devices'][0]['health']);
        $this->assertSame('02:aa:bb:cc:dd:ee', $snapshot['devices'][0]['mac_address']);
        $this->assertSame($this->device()['HostName'], $snapshot['devices'][0]['name']);
    }

    public function test_explicit_empty_lists_are_valid(): void
    {
        $this->assertSame([], (new SkyworthDeviceSnapshot)->parse($this->page())['devices']);
    }

    public function test_rejects_login_pages_instead_of_reporting_no_devices(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new SkyworthDeviceSnapshot)->parse('<html>Login</html>');
    }

    public function test_rejects_executable_expressions(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new SkyworthDeviceSnapshot)->parse('var result_lan = []; var result_Wifi = [alert(1)];');
    }

    public function test_rejects_duplicates(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new SkyworthDeviceSnapshot)->parse($this->page([$this->device(), $this->device()]));
    }

    public function test_rejects_unknown_status(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new SkyworthDeviceSnapshot)->parse($this->page([array_replace($this->device(), ['status' => 'healthy'])]));
    }
}
