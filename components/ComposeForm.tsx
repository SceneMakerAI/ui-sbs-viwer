"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { BUDGET_OPTIONS, DEFAULT_BUDGET_SEC } from "@/lib/domain/budget";

const EXAMPLES = ["홈런 모음", "이닝별 하이라이트", "역전 장면만", "득점 장면"];

/** 진행 폴링 주기(ms). 편성은 1~3분 걸린다. */
const POLL_MS = 3000;
/** 대기 중 재시도 주기(ms) — 다른 요청이 끝나면 자동으로 시작되게 한다(PAGES.md §5). */
const RETRY_MS = 5000;

type Phase = "idle" | "waiting" | "running";

/** 스위치 하나. 최대 길이 옆 옵션들이 같은 모양을 쓰므로 한 곳에 둔다. */
function Toggle({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-brand-blue" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-0.5 block h-5 w-5 rounded-full bg-surface transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function ComposeForm({ vId }: { vId: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [budgetSec, setBudgetSec] = useState<number>(DEFAULT_BUDGET_SEC);
  // 편성에 이어 하이라이트 영상까지 한 번에 만들지(원샷). 끄면 편성만 하고,
  // 영상은 결과 화면에서 따로 만든다. 기본 On — 지금까지의 동작이다.
  const [render, setRender] = useState(true);
  // 범퍼는 영상을 만들 때만 쓰는 출력 옵션이라 위 토글에 딸린다.
  const [bumper, setBumper] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const jobRef = useRef<string | null>(null);
  const submitRef = useRef<(() => void) | null>(null);

  // 화면 진입 시 다른 요청이 처리 중인지 확인한다 — 다른 PC 의 작업도 보여야 한다.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/compose", { cache: "no-store" });
        const j = await r.json();
        if (alive) setBusy(Boolean(j.busy));
      } catch {
        /* 표시용이라 실패는 무시한다 */
      }
    };
    check();
    const t = setInterval(check, RETRY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const poll = useCallback(
    async (jobId: string) => {
      try {
        const r = await fetch(`/api/compose/${jobId}`, { cache: "no-store" });
        const j = await r.json();

        if (!r.ok) {
          // 잡 캐시가 사라졌어도 편성 자체는 DB 에 저장돼 있을 수 있다.
          setError(j.error ?? "진행 상황을 가져오지 못했습니다.");
          setPhase("idle");
          return;
        }

        setProgress(j.progress ?? []);

        if (j.status === "running") {
          setTimeout(() => poll(jobId), POLL_MS);
          return;
        }
        if (j.status === "error") {
          setError(j.error ?? "편성에 실패했습니다. 질의를 바꿔 다시 시도해 주세요.");
          setPhase("idle");
          return;
        }
        if (j.status === "empty") {
          setError("조건에 맞는 장면을 찾지 못했습니다. 질의를 바꿔 다시 시도해 보세요.");
          setPhase("idle");
          return;
        }
        // 완료 — 결과 페이지로.
        router.push(`/c/${j.compId}`);
      } catch {
        setError("진행 상황을 가져오지 못했습니다.");
        setPhase("idle");
      }
    },
    [router],
  );

  const submit = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vId, query: query.trim(), budgetSec, render, bumper: render && bumper }),
      });
      // 게이트웨이(nginx)가 끼어들면 본문이 HTML 이라 JSON 파싱이 터진다 —
      // 그때도 상태 코드로 상황을 구분해야 해서 파싱 실패를 삼킨다.
      const j: { code?: string; error?: string; jobId?: string } = await r
        .json()
        .catch(() => ({}));

      if (r.status === 429 || r.status === 503) {
        setError("요청이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.");
        setPhase("idle");
        return;
      }

      if (r.status === 409 && j.code === "COMPOSE_BUSY") {
        // 거절이 아니라 대기다 — 순서가 되면 자동으로 시작한다.
        setPhase("waiting");
        setBusy(true);
        setTimeout(() => submitRef.current?.(), RETRY_MS);
        return;
      }
      if (!r.ok) {
        setError(j.error ?? "편성 요청에 실패했습니다.");
        setPhase("idle");
        return;
      }

      if (!j.jobId) {
        setError("편성 요청에 실패했습니다.");
        setPhase("idle");
        return;
      }
      jobRef.current = j.jobId;
      setPhase("running");
      setProgress([]);
      poll(j.jobId);
    } catch {
      setError("편성 요청 중 오류가 발생했습니다.");
      setPhase("idle");
    }
  }, [budgetSec, bumper, poll, query, render, vId]);

  submitRef.current = submit;

  const disabled = phase !== "idle" || query.trim().length < 2;

  return (
    <div className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-bold">어떤 장면을 모아볼까요?</h2>
      <p className="mt-2 text-sm text-text-secondary">
        보고 싶은 장면을 문장으로 적어주세요. 경기 전체에서 해당 장면만 찾아 하나의 영상으로 만들어 드립니다.
      </p>

      {busy && phase !== "running" && (
        <p className="mt-4 flex items-center gap-2 rounded border border-brand-blue/30 bg-brand-blue-soft px-3 py-2.5 text-sm text-brand-blue">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          다른 요청을 처리하고 있습니다. 순서가 되면 자동으로 시작됩니다.
        </p>
      )}

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={2}
        maxLength={200}
        disabled={phase !== "idle"}
        placeholder="예) 경기 흐름을 바꾼 결정적 장면"
        aria-label="편성할 장면 설명"
        className="mt-4 w-full resize-none rounded border border-line bg-surface-alt px-4 py-3 text-sm outline-none focus:border-brand-blue disabled:opacity-60"
      />

      <p className="mt-4 text-xs text-text-muted">이런 것도 만들 수 있어요</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={phase !== "idle"}
            onClick={() => setQuery(ex)}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            {/* 이제 budget 은 실제로 지켜지는 상한이다 — 넘치는 만큼 중요도가 낮은 클립부터
                버린다(덜어내기 전용, lib/domain/budget.ts). 모자라면 모자란 대로 나온다. */}
            <p className="text-xs text-text-muted">최대 길이</p>
            <div className="mt-1.5 inline-flex rounded border border-line p-1">
              {BUDGET_OPTIONS.map((o) => (
                <button
                  key={o.sec}
                  type="button"
                  disabled={phase !== "idle"}
                  onClick={() => setBudgetSec(o.sec)}
                  aria-pressed={budgetSec === o.sec}
                  className={`rounded px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                    budgetSec === o.sec
                      ? "bg-ink font-bold text-on-dark"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 max-w-[15rem] text-xs text-text-muted">
              넘으면 덜 중요한 장면부터 빠집니다. 짧게 나올 수도 있습니다.
            </p>
          </div>

          {/* 왼쪽의 "최대 길이"(편성 조건)와 오른쪽 옵션(영상 출력)은 성격이 다르다 — 세로선으로 가른다. */}
          {/* 두 스위치는 위쪽(라벨)을 맞춰 나란히 서게 한다 — 아래 안내문 길이가 서로 달라서
              items-end 로 두면 스위치 높이가 어긋난다. */}
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4 sm:border-l sm:border-line sm:pl-8">
            <div>
              <p className="text-xs text-text-muted">하이라이트 영상 바로 생성</p>
              <div className="mt-1.5 flex items-center gap-2 py-1.5">
                <Toggle
                  checked={render}
                  disabled={phase !== "idle"}
                  label="하이라이트 영상 바로 생성"
                  onToggle={() => setRender((v) => !v)}
                />
                <span className="text-sm text-text-secondary">{render ? "생성" : "편성만"}</span>
              </div>
              {/* 안내문이 길어져도 옆 칸을 밀어내지 않게 폭을 묶고 접히게 둔다. */}
              <p className="mt-1 max-w-[13rem] text-xs text-text-muted">
                {render
                  ? "영상 생성에 추가 시간이 필요합니다."
                  : "영상은 결과 화면에서 만들 수 있습니다."}
              </p>
            </div>

            <div>
              <p className="text-xs text-text-muted">이닝 사이 범퍼</p>
              <div className="mt-1.5 flex items-center gap-2 py-1.5">
                <Toggle
                  checked={render && bumper}
                  // 영상을 안 만들면 범퍼가 들어갈 자리도 없다.
                  disabled={phase !== "idle" || !render}
                  label="이닝 사이 범퍼 넣기"
                  onToggle={() => setBumper((v) => !v)}
                />
                <span className={`text-sm ${render ? "text-text-secondary" : "text-text-muted"}`}>
                  {render ? (bumper ? "넣기" : "안 넣기") : "해당 없음"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={submit}
          className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded bg-brand-blue px-6 py-3 text-sm font-bold text-on-dark transition-colors hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "idle" ? (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              클립 편성하기
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {phase === "waiting" ? "대기 중" : "편성 중"}
            </>
          )}
        </button>
      </div>

      {phase === "running" && (
        <div className="mt-4 rounded border border-line bg-surface-alt p-4">
          <p className="text-sm font-bold">
            {progress.length > 0 ? progress[progress.length - 1] : "편성을 시작하는 중"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            장면을 고른 뒤 영상까지 만듭니다. 보통 몇 분 걸리니 이 페이지를 열어 두세요.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
