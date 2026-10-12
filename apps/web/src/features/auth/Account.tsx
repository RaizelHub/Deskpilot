import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSession } from "./session";
import { api, json } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, Field } from "@/components/shared";

const schema = z
  .object({
    current_password: z.string().min(1),
    password: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-zA-Z]/)
      .regex(/[0-9]/),
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, {
    path: ["password_confirmation"],
    message: "Passwords must match.",
  });
export function Account() {
  const session = useSession();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof schema>) =>
      api<{ message: string }>("/auth/password", json("POST", data)),
    onSuccess: () => form.reset(),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE IDENTITY</span>
          <h1>My account</h1>
          <p>
            {session.data?.user.name} · {session.data?.user.email}
          </p>
        </div>
      </div>
      <section className="panel account-panel">
        <h2>Change password</h2>
        <p>
          Use at least 12 characters, including letters and numbers. Other
          sessions will need to sign in again.
        </p>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
          {(
            ["current_password", "password", "password_confirmation"] as const
          ).map((key, i) => (
            <Field
              key={key}
              label={
                ["Current password", "New password", "Confirm new password"][i]
              }
              htmlFor={key}
              error={form.formState.errors[key]?.message}
            >
              <input
                id={key}
                type="password"
                autoComplete={i === 0 ? "current-password" : "new-password"}
                {...form.register(key)}
              />
            </Field>
          ))}
          {mutation.error && <ErrorNotice error={mutation.error} />}{" "}
          {mutation.data && (
            <div className="success-notice" role="status">
              {mutation.data.message}
            </div>
          )}
          <Button disabled={mutation.isPending}>Update password</Button>
        </form>
      </section>
    </>
  );
}
