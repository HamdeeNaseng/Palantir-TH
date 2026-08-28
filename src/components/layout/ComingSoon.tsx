import TopNav from "./TopNav";

export default function ComingSoon({
  href,
  title,
  note,
}: {
  href: string;
  title: string;
  note: string;
}) {
  return (
    <>
      <TopNav active={href} />
      <main className="flex flex-1 items-center justify-center bg-abyss px-4 py-16">
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold text-ink">{title}</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{note}</p>
        </div>
      </main>
    </>
  );
}
