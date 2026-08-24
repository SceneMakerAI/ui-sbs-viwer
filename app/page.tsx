import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ComposeRow from "@/components/ComposeRow";
import VideoCard from "@/components/VideoCard";
import { getSummary, listComposes } from "@/lib/server/composes";
import { listVideos } from "@/lib/server/videos";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [summary, videos, composes] = await Promise.all([
    getSummary(),
    listVideos({ limit: 4 }),
    listComposes({ limit: 4 }),
  ]);

  const metrics = [
    { label: "업로드 영상", value: summary.videos },
    { label: "편성 클립", value: summary.composes },
    { label: "완성 영상", value: summary.rendered },
  ];

  return (
    <>
      <section className="bg-ink text-on-dark">
        <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 sm:py-16">
          <h1 className="text-2xl leading-tight font-bold tracking-tight sm:text-4xl">
            보고 싶은 장면만 골라
            <br />
            <span className="text-brand-blue">클립으로 편성</span>합니다.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-on-dark-dim sm:text-base">
            경기 영상을 문장으로 검색하면 해당 장면을 찾아 하나의 영상으로 이어 붙입니다.
          </p>

          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 sm:mt-10">
            {metrics.map((m) => (
              <div key={m.label}>
                <dt className="text-xs text-on-dark-dim">{m.label}</dt>
                <dd className="mt-1 text-2xl font-bold sm:text-3xl">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] space-y-12 px-4 py-10 sm:px-6 sm:py-12">
        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-lg font-bold">분석 완료 영상</h2>
            <Link
              href="/videos"
              className="inline-flex items-center gap-1 text-sm font-bold text-brand-blue hover:underline"
            >
              전체 보기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {videos.items.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-alt p-8 text-center text-sm text-text-secondary">
              아직 등록된 영상이 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {videos.items.map((v) => (
                <VideoCard key={v.vId} video={v} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-lg font-bold">최근 편성 클립</h2>
            <Link
              href="/clips"
              className="inline-flex items-center gap-1 text-sm font-bold text-brand-blue hover:underline"
            >
              전체 보기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {composes.items.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-alt p-8 text-center text-sm text-text-secondary">
              아직 편성한 클립이 없습니다. 영상을 골라 첫 편성을 만들어 보세요.
            </p>
          ) : (
            <div className="space-y-2">
              {composes.items.map((c) => (
                <ComposeRow key={c.compId} compose={c} showVideo />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
