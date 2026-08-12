"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AiGeneratedBadge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  MasteryMeter,
  ProgressBar,
  StatusBadge,
} from "@/components/ui/primitives";
import { bloomLabel, formatCitation } from "@/lib/utils";

interface ServedItem {
  attemptItemId: string;
  questionId: string;
  type: string;
  stem: string;
  options: Array<{ key: string; text: string }> | null;
  ordinal: number;
  topicTitle: string;
  bloomLevel: number;
  servedDifficulty: number;
  itemsPlanned: number;
  itemsAnswered: number;
}

interface AnswerResult {
  correct: boolean;
  correctKey: string | null;
  explanation: string;
  misconception: { code: string; description: string; remediation: string } | null;
  feedback: {
    likelyReasoning: string;
    whereItFails: string;
    correctReasoning: string;
    nextStep: string;
    citations: Array<{
      chunkId: string;
      materialTitle: string;
      sectionPath: string | null;
      pageFrom: number | null;
      pageTo: number | null;
    }>;
  } | null;
  masteryBefore: number;
  masteryAfter: number;
  pointsAwarded: number;
  pointsReason: string;
  newBadges: string[];
  streak: { current: number; longest: number };
  planRegenerated: boolean;
}

export function QuizClient({ courseId }: { courseId: string }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [item, setItem] = useState<ServedItem | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(Date.now());

  const loadNext = useCallback(
    async (id: string) => {
      setBusy(true);
      setResult(null);
      setResponse("");

      const res = await fetch(`/api/student/quiz/${id}/next`);
      if (!res.ok) {
        setError("Could not load the next question.");
        setBusy(false);
        return;
      }
      const body = (await res.json()) as {
        item: ServedItem | null;
        finished: boolean;
        reason?: string;
      };

      if (body.finished || !body.item) {
        setFinished(body.reason ?? "finished");
        setItem(null);
      } else {
        setItem(body.item);
        setStartedAt(Date.now());
      }
      setBusy(false);
    },
    [],
  );

  async function start() {
    setBusy(true);
    setError(null);
    setFinished(null);

    const res = await fetch("/api/student/quiz/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, itemsPlanned: 10 }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Could not start a practice run.");
      setBusy(false);
      return;
    }
    const { attemptId: id } = (await res.json()) as { attemptId: string };
    setAttemptId(id);
    await loadNext(id);
  }

  async function submit() {
    if (!attemptId || !item || response.trim().length === 0) return;
    setBusy(true);

    const res = await fetch(`/api/student/quiz/${attemptId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attemptItemId: item.attemptItemId,
        response,
        responseMs: Date.now() - startedAt,
      }),
    });

    if (!res.ok) {
      setError("Could not submit that answer.");
      setBusy(false);
      return;
    }

    setResult((await res.json()) as AnswerResult);
    setBusy(false);
  }

  useEffect(() => {
    if (!attemptId) return;
    // Nothing to poll — this only guards against a mounted-but-empty state.
  }, [attemptId]);

  if (!attemptId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adaptive practice</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ten questions, chosen one at a time from how you are doing. The difficulty and the
            cognitive level both rise as your mastery does.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button onClick={() => void start()} disabled={busy}>
            {busy ? "Starting…" : "Start practice"}
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (finished) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Practice complete"
          hint={
            finished === "mastery"
              ? "You reached the mastery threshold with a sustained correct streak — the run ended early on purpose."
              : finished === "count"
                ? "You answered every planned question."
                : finished
          }
        />
        <Button
          onClick={() => {
            setAttemptId(null);
            setFinished(null);
          }}
        >
          Start another run
        </Button>
      </div>
    );
  }

  if (!item) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <ProgressBar
        value={item.ordinal}
        max={item.itemsPlanned}
        label={`Question ${item.ordinal + 1} of ${item.itemsPlanned}`}
      />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {item.topicTitle} · Bloom {item.bloomLevel} ({bloomLabel(item.bloomLevel)})
          </div>
          <div className="flex items-center gap-2">
            <AiGeneratedBadge />
            {/* Making the adaptation visible is the point of showing this. */}
            <StatusBadge
              kind="info"
              label={`difficulty ${item.servedDifficulty.toFixed(2)}`}
            />
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          <p className="text-base leading-relaxed">{item.stem}</p>

          {item.options ? (
            <fieldset className="space-y-2" disabled={result !== null}>
              <legend className="sr-only">Answer options</legend>
              {item.options.map((option) => {
                const isChosen = response === option.key;
                const isCorrectKey = result?.correctKey === option.key;
                const showWrong = result !== null && isChosen && !result.correct;

                return (
                  <label
                    key={option.key}
                    className={[
                      "flex cursor-pointer gap-3 rounded-md border p-3 text-sm",
                      result === null && isChosen ? "border-primary bg-accent" : "",
                      result !== null && isCorrectKey
                        ? "border-success bg-success/10"
                        : "",
                      showWrong ? "border-destructive bg-destructive/10" : "",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="answer"
                      value={option.key}
                      checked={isChosen}
                      onChange={(e) => setResponse(e.target.value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">{option.key}.</span> {option.text}
                      {/* Correctness is conveyed in text, not by colour alone. */}
                      {result !== null && isCorrectKey && (
                        <span className="ml-2 text-xs font-medium text-success">
                          ✓ correct answer
                        </span>
                      )}
                      {showWrong && (
                        <span className="ml-2 text-xs font-medium text-destructive">
                          ✕ your answer
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="saq" className="block text-sm font-medium">
                Your answer
              </label>
              <textarea
                id="saq"
                rows={5}
                value={response}
                disabled={result !== null}
                onChange={(e) => setResponse(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          )}

          {result === null ? (
            <Button
              onClick={() => void submit()}
              disabled={busy || response.trim().length === 0}
            >
              {busy ? "Checking…" : "Submit answer"}
            </Button>
          ) : (
            <Button onClick={() => void loadNext(attemptId)} disabled={busy}>
              {busy ? "Loading…" : "Next question"}
            </Button>
          )}
        </CardBody>
      </Card>

      {result && <FeedbackPanel result={result} />}
    </div>
  );
}

function FeedbackPanel({ result }: { result: AnswerResult }) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{result.correct ? "Correct" : "Not quite"}</CardTitle>
        <div className="flex items-center gap-2">
          <StatusBadge
            kind={result.correct ? "success" : "error"}
            label={result.correct ? "correct" : "incorrect"}
          />
          {result.feedback && <AiGeneratedBadge />}
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {/*
          The misconception is named explicitly — FR-STU-011. "Incorrect" alone
          teaches nothing; the name is what a student can go and read about.
        */}
        {result.misconception && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-medium text-warning">
              Misconception {result.misconception.code}
            </p>
            <p className="mt-1 text-sm">{result.misconception.description}</p>
          </div>
        )}

        {result.feedback ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">What you were probably thinking</dt>
              <dd className="mt-0.5 text-muted-foreground">
                {result.feedback.likelyReasoning}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Where it breaks down</dt>
              <dd className="mt-0.5 text-muted-foreground">
                {result.feedback.whereItFails}
              </dd>
            </div>
            <div>
              <dt className="font-medium">The correct reasoning</dt>
              <dd className="mt-0.5 text-muted-foreground">
                {result.feedback.correctReasoning}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Next step</dt>
              <dd className="mt-0.5 text-muted-foreground">{result.feedback.nextStep}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{result.explanation}</p>
        )}

        {/* Citations render as `section_path · pp. from–to` (design.md §12). */}
        {result.feedback && result.feedback.citations.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium">Sources</p>
            <ul className="mt-1 space-y-0.5">
              {result.feedback.citations.map((citation) => (
                <li key={citation.chunkId} className="text-xs text-muted-foreground">
                  {citation.materialTitle} — {formatCitation(citation)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <MasteryMeter value={result.masteryAfter} label="Topic mastery" />
          <div className="space-y-1 text-xs">
            {result.pointsAwarded > 0 ? (
              <p className="font-medium text-success">+{result.pointsAwarded} points</p>
            ) : (
              <p className="text-muted-foreground">{result.pointsReason}</p>
            )}
            <p className="text-muted-foreground">
              Streak: {result.streak.current} day{result.streak.current === 1 ? "" : "s"}
            </p>
            {result.newBadges.map((badge) => (
              <p key={badge} className="font-medium text-primary">
                Badge earned: {badge.replace(/_/g, " ")}
              </p>
            ))}
            {result.planRegenerated && (
              <p className="text-muted-foreground">Your learning plan was updated.</p>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
