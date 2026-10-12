<?php

namespace App\Services;

use App\Models\TicketAttachment;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class TicketAttachmentService
{
    public function __construct(private TicketAccess $access, private TicketService $tickets) {}

    public function upload(User $actor, string $id, UploadedFile $file, bool $internal): TicketAttachment
    {
        $ticket = $this->access->find($actor, $id);
        abort_unless($internal ? $actor->hasPermission('tickets.notes') : $this->access->canReply($actor, $ticket), 403);
        [$bytes, $mime, $extension] = $this->sanitize($file);
        $path = $id.'/'.Str::uuid().'.'.$extension;
        try {
            return DB::transaction(function () use ($actor, $id, $file, $internal, $bytes, $mime, $extension, $path) {
                $ticket = $this->access->find($actor, $id, true);
                if ($ticket->status === 'closed') {
                    throw ValidationException::withMessages(['file' => 'Reopen this closed ticket before uploading files.']);
                }
                if ($ticket->attachments()->count() >= 20 || $ticket->attachments()->sum('size') + strlen($bytes) > 20 * 1024 * 1024) {
                    throw ValidationException::withMessages(['file' => 'This ticket has reached its attachment limit (20 files or 20 MiB).']);
                }
                Storage::disk('tickets')->put($path, $bytes);
                $base = pathinfo(basename(str_replace('\\', '/', $file->getClientOriginalName())), PATHINFO_FILENAME);
                $base = trim(preg_replace('/[^\pL\pN ._-]/u', '_', $base) ?? 'attachment', '. ');
                $attachment = $ticket->attachments()->create(['uploader_id' => $actor->id, 'filename' => (mb_substr($base, 0, 120) ?: 'attachment').'.'.$extension, 'storage_path' => $path, 'mime_type' => $mime, 'size' => strlen($bytes), 'is_internal' => $internal]);
                $ticket->version++;
                $ticket->save();
                $this->tickets->history($ticket, $actor, 'attachment_added', ['filename' => $attachment->filename], $internal);

                return $attachment->load('uploader:id,name');
            });
        } catch (\Throwable $e) {
            Storage::disk('tickets')->delete($path);
            throw $e;
        }
    }

    public function find(User $actor, string $ticketId, string $attachmentId): TicketAttachment
    {
        $ticket = $this->access->find($actor, $ticketId);

        return $ticket->attachments()->when(! $actor->hasPermission('tickets.notes'), fn ($q) => $q->where('is_internal', false))->findOrFail($attachmentId);
    }

    public function delete(User $actor, string $ticketId, string $attachmentId): void
    {
        $path = DB::transaction(function () use ($actor, $ticketId, $attachmentId) {
            $ticket = $this->access->find($actor, $ticketId, true);
            $file = $this->find($actor, $ticketId, $attachmentId);
            abort_unless($file->uploader_id === $actor->id || $actor->hasPermission('tickets.update'), 403);
            $this->tickets->history($ticket, $actor, 'attachment_deleted', ['filename' => $file->filename], $file->is_internal);
            $file->delete();
            $ticket->version++;
            $ticket->save();

            return $file->storage_path;
        });
        Storage::disk('tickets')->delete($path);
    }

    private function sanitize(UploadedFile $file): array
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $bytes = file_get_contents($file->getRealPath());
        if ($extension === 'txt' && mb_check_encoding($bytes, 'UTF-8') && ! str_contains($bytes, "\0") && in_array($file->getMimeType(), ['text/plain', 'application/x-empty'], true)) {
            return [$bytes, 'text/plain', 'txt'];
        }
        $mime = $file->getMimeType();
        if (! in_array($extension, ['png', 'jpg', 'jpeg'], true) || ! in_array($mime, ['image/png', 'image/jpeg'], true) || ($extension === 'png') !== ($mime === 'image/png')) {
            throw ValidationException::withMessages(['file' => 'Upload a valid UTF-8 TXT, PNG, or JPEG file. Other formats are not supported.']);
        }
        $size = @getimagesizefromstring($bytes);
        if (! $size || $size[0] > 6000 || $size[1] > 6000 || $size[0] * $size[1] > 12000000) {
            throw ValidationException::withMessages(['file' => 'Image dimensions exceed the limit (12 megapixels, 6000 pixels per side).']);
        }
        $image = @imagecreatefromstring($bytes);
        if (! $image) {
            throw ValidationException::withMessages(['file' => 'The image could not be decoded.']);
        }
        ob_start();
        try {
            if ($mime === 'image/png') {
                imagesavealpha($image, true);
                imagepng($image);
            } else {
                imagejpeg($image, null, 90);
            } $safe = ob_get_contents();
        } finally {
            ob_end_clean();
            imagedestroy($image);
        }
        if (strlen($safe) > 5 * 1024 * 1024) {
            throw ValidationException::withMessages(['file' => 'The processed image exceeds 5 MiB. Resize it and try again.']);
        }

        return [$safe, $mime, $mime === 'image/png' ? 'png' : 'jpg'];
    }
}
