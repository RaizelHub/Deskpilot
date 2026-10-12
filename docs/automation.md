# Automation status

Phase 1 configures Laravel queues and a scheduler process. The worker handles email notifications. No device automation, outbound webhook delivery, n8n workflow, or automated command execution is enabled.

Phase 8 will add signed webhooks, event IDs, timestamped HMAC signatures, bounded exponential retries, replay protection at receivers, delivery history and explicit administrative enablement. AI suggestions will use the same authorized command boundary as human requests; they cannot bypass it.
