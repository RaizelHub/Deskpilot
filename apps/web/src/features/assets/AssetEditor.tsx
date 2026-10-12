import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Field, Loading } from "@/components/shared";
import { useSession } from "@/features/auth/session";
import {
  categories,
  statuses,
  label,
  type Asset,
  type AssetOptions,
  type Named,
} from "./types";

export function AssetEditor({
  asset,
  close,
}: {
  asset: Asset | null;
  close: () => void;
}) {
  const client = useQueryClient();
  const session = useSession();
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<Named | null>(
    asset?.device ?? null,
  );
  const options = useQuery({
    queryKey: ["asset-options", search],
    queryFn: () =>
      api<AssetOptions>(`/asset-options?search=${encodeURIComponent(search)}`),
    placeholderData: (previous) => previous,
  });
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(
        asset ? `/assets/${asset.id}` : "/assets",
        json(asset ? "PATCH" : "POST", data),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["assets"] });
      close();
    },
  });
  if (options.isPending) return <Loading />;
  if (options.error)
    return (
      <ErrorNotice error={options.error} retry={() => void options.refetch()} />
    );
  const devices = options.data!.devices;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const data: Record<string, unknown> = Object.fromEntries(
          [...form].map(([k, v]) => [k, v === "" ? null : v]),
        );
        if (!session.data?.permissions.includes("devices.view"))
          data.device_id = asset?.device_id ?? null;
        if (asset) data.version = asset.version;
        save.mutate(data);
      }}
    >
      <div className="form-grid">
        <Field label="Asset tag" htmlFor="asset-tag">
          <input
            id="asset-tag"
            name="tag"
            required
            maxLength={40}
            pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
            placeholder="IT-LAP-001"
            defaultValue={asset?.tag ?? ""}
          />
        </Field>
        <Field label="Asset name" htmlFor="asset-name">
          <input
            id="asset-name"
            name="name"
            required
            maxLength={160}
            defaultValue={asset?.name ?? ""}
          />
        </Field>
        <Field label="Category" htmlFor="asset-category">
          <select
            id="asset-category"
            name="category"
            defaultValue={asset?.category ?? "laptop"}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asset status" htmlFor="asset-status">
          <select
            id="asset-status"
            name="status"
            defaultValue={asset?.status ?? "available"}
          >
            {(asset?.current_assignment
              ? ["in_use"]
              : statuses.filter((s) => s !== "in_use")
            ).map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Manufacturer" htmlFor="asset-manufacturer">
          <input
            id="asset-manufacturer"
            name="manufacturer"
            maxLength={120}
            defaultValue={asset?.manufacturer ?? ""}
          />
        </Field>
        <Field label="Model" htmlFor="asset-model">
          <input
            id="asset-model"
            name="model"
            maxLength={160}
            defaultValue={asset?.model ?? ""}
          />
        </Field>
        <Field label="Serial number" htmlFor="asset-serial">
          <input
            id="asset-serial"
            name="serial_number"
            maxLength={160}
            defaultValue={asset?.serial_number ?? ""}
          />
        </Field>
        <Field label="Location" htmlFor="asset-location">
          <input
            id="asset-location"
            name="location"
            maxLength={160}
            defaultValue={asset?.location ?? ""}
          />
        </Field>
        <Field label="Purchase date" htmlFor="asset-purchase">
          <input
            id="asset-purchase"
            type="date"
            name="purchased_on"
            defaultValue={asset?.purchased_on ?? ""}
          />
        </Field>
        <Field label="Warranty expiration" htmlFor="asset-warranty">
          <input
            id="asset-warranty"
            type="date"
            name="warranty_expires_on"
            defaultValue={asset?.warranty_expires_on ?? ""}
          />
        </Field>
        <Field label="Department" htmlFor="asset-department">
          <select
            id="asset-department"
            name="department_id"
            defaultValue={asset?.department_id ?? ""}
          >
            <option value="">No department</option>
            {options.data!.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {session.data?.permissions.includes("devices.view") && (
        <>
          <Field label="Find enrolled device" htmlFor="asset-device-search">
            <input
              id="asset-device-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search device name"
            />
          </Field>
          <Field label="Linked device" htmlFor="asset-device">
            <select
              id="asset-device"
              name="device_id"
              value={selectedDevice?.id ?? ""}
              onChange={(e) =>
                setSelectedDevice(
                  devices.find((d) => d.id === e.target.value) ??
                    (selectedDevice?.id === e.target.value
                      ? selectedDevice
                      : null),
                )
              }
            >
              <option value="">No linked device</option>
              {selectedDevice &&
                !devices.some((d) => d.id === selectedDevice.id) && (
                  <option value={selectedDevice.id}>
                    {selectedDevice.name}
                  </option>
                )}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="Asset notes" htmlFor="asset-notes">
        <textarea
          id="asset-notes"
          name="notes"
          maxLength={5000}
          rows={3}
          defaultValue={asset?.notes ?? ""}
        />
      </Field>
      {asset?.current_assignment && (
        <p>Return this asset before changing its status.</p>
      )}
      {save.error && <ErrorNotice error={save.error} />}
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button icon="save" disabled={save.isPending}>
          Save asset
        </Button>
      </div>
    </form>
  );
}
