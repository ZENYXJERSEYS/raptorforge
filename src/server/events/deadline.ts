import { Errors } from "@/server/errors";

/**
 * Server-side deadline enforcement. `now` comes from the server clock only —
 * clients cannot influence it (see THREAT-MODEL.md "deadline gaming").
 * Throws 423 SUBMISSION_DEADLINE_PASSED.
 */
export function enforceSubmissionDeadline(
  event: { submissionDeadline: Date },
  now = new Date()
): void {
  if (now.getTime() > event.submissionDeadline.getTime()) {
    throw Errors.deadlinePassed();
  }
}

export function deadlineHasPassed(event: { submissionDeadline: Date }, now = new Date()): boolean {
  return now.getTime() > event.submissionDeadline.getTime();
}
