import { requireCourseAccess } from "@/auth/guard";
import { blueprintSchema, generateAssessment } from "@/teacher/assessment-gen";
import { errorResponse } from "@/lib/http";

/**
 * Streams generation progress per item (FR-TCH-002, NFR-PRF-002).
 *
 * NDJSON rather than SSE: the client only needs one-way ordered events, and a
 * newline-delimited stream is trivially parseable without an EventSource
 * polyfill on the server side.
 *
 * Runs for minutes on a ten-item blueprint, so it must stream — a non-streaming
 * response would hit an HTTP timeout (NFR-REL-004).
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let blueprint;
  let actor;

  // Parse and authorise BEFORE opening the stream: once headers are sent, an
  // error can only be reported as a stream event, which is far less useful to
  // a client than a real status code.
  try {
    blueprint = blueprintSchema.parse(await request.json());
    actor = await requireCourseAccess(blueprint.courseId, "teacher");
  } catch (error: unknown) {
    return errorResponse(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of generateAssessment(actor, blueprint)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error: unknown) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              kind: "fatal",
              message: error instanceof Error ? error.message : String(error),
            })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Stops a reverse proxy buffering the stream and defeating the progress UI.
      "x-accel-buffering": "no",
    },
  });
}
