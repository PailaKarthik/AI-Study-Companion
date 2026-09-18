"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { registerSchema } from "@ai-study-companion/validation";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { Field } from "@/components/shared/form";
import { FadeIn } from "@/components/shared/motion";
import { useToast } from "@/components/shared/toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRegister } from "@/features/auth";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";

const formSchema = registerSchema;
type FormValues = z.infer<typeof formSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const register = useRegister();
  const { success, error: notifyError } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await register.mutateAsync(values);
      success("Account created", "Welcome to your learning workspace.");
      router.replace("/");
    } catch (err) {
      notifyError("Registration failed", toUserMessage(err));
    }
  }

  const error = register.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center overflow-hidden px-6 py-12">
      <FadeIn>
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Study Companion home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            AI
          </span>
          <span className="text-lg font-semibold tracking-tight">Study Companion</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>Start learning anything, deeply.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <Field
                id="name"
                label="Name"
                error={form.formState.errors.name}
                registration={form.register("name")}
                inputProps={{ type: "text", autoComplete: "name", placeholder: "Ada Lovelace" }}
              />
              <Field
                id="email"
                label="Email"
                error={form.formState.errors.email}
                registration={form.register("email")}
                inputProps={{ type: "email", autoComplete: "email", placeholder: "you@example.com" }}
              />
              <Field
                id="password"
                label="Password"
                error={form.formState.errors.password}
                hint="At least 8 characters."
                registration={form.register("password")}
                inputProps={{
                  type: "password",
                  autoComplete: "new-password",
                  placeholder: "At least 8 characters",
                }}
              />
              {error ? (
                <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} />
              ) : null}
              <Button type="submit" disabled={register.isPending}>
                {register.isPending ? "Creating account…" : "Register"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-foreground underline">
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </FadeIn>
    </main>
  );
}
