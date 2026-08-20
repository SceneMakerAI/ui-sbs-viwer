import Link from "next/link";

/**
 * 404·에러 화면 공용 틀.
 * 없는 자원을 열었을 때 기본 Next 404(영문)가 그대로 노출되지 않게 한다 —
 * 고객사에 보이는 화면이라 문구와 다음 행동을 우리가 정한다.
 */
export default function StatusScreen({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: { href: string; label: string; primary?: boolean }[];
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center sm:py-32">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt text-text-muted">
        {icon}
      </span>
      <h1 className="mt-6 text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`rounded px-5 py-3 text-sm font-bold transition-colors ${
              a.primary
                ? "bg-brand-blue text-on-dark hover:bg-brand-blue-hover"
                : "border border-line text-text-secondary hover:border-brand-blue hover:text-brand-blue"
            }`}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
