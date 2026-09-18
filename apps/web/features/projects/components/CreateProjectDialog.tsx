"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createProjectSchema } from "@ai-study-companion/validation";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { Field } from "@/components/shared/form";
import { useToast } from "@/components/shared/toaster";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { useCreateProject } from "../hooks";

const formSchema = createProjectSchema;
type FormValues = z.infer<typeof formSchema>;

/** Create-project dialog. On success closes, toasts, and opens the project. */
export function CreateProjectDialog({
  spaceId,
  open,
  onOpenChange,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createProject = useCreateProject(spaceId);
  const { success, error: notifyError } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", goal: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      const project = await createProject.mutateAsync(values);
      success("Project created", `"${project.name}" is ready.`);
      form.reset();
      onOpenChange(false);
      router.push(`/spaces/${spaceId}/projects/${project.id}`);
    } catch (err) {
      notifyError("Could not create project", toUserMessage(err));
    }
  }

  const error = createProject.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  const goalError = form.formState.errors.goal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Start a focused learning journey in this space.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field
            id="project-name"
            label="Project name"
            error={form.formState.errors.name}
            registration={form.register("name")}
            inputProps={{ placeholder: "Operating Systems", autoComplete: "off" }}
          />
          <Field
            id="project-description"
            label="Description (optional)"
            error={form.formState.errors.description}
            registration={form.register("description")}
            inputProps={{ placeholder: "What will you learn?", autoComplete: "off" }}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-goal" className="text-sm font-medium">
              Learning goal (optional)
            </label>
            <Textarea
              id="project-goal"
              placeholder="Understand processes, memory, scheduling and file systems"
              aria-invalid={goalError ? true : undefined}
              aria-describedby={goalError ? "project-goal-error" : undefined}
              {...form.register("goal")}
            />
            {goalError?.message ? (
              <p id="project-goal-error" role="alert" className="text-sm text-destructive">
                {goalError.message}
              </p>
            ) : null}
          </div>
          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
