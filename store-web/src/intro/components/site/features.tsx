import {
  CardContainer,
  CardBody,
  CardItem,
} from "@/components/aceternity/3d-card-effect";
import { useLocale } from "@/intro/i18n";
import { SectionHead } from "./brand";

/** Stroke SVG paths, one per feature card, drawn in the brand purple. */
const ICONS = [
  // Agent 主轴 — planning spoke
  <path key="spoke" d="M12 3v4m0 10v4M3 12h4m10 0h4m-4.6-5.4-2.8 2.8m-5.2 5.2-2.8 2.8m0-10.8 2.8 2.8m5.2 5.2 2.8 2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  // FengyuFlow — DAG nodes
  <g key="dag">
    <rect x="4" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="15" y="15" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 6.5h4a4 4 0 0 1 4 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </g>,
  // .fyp — package hex
  <path key="pkg" d="M12 3 19 7v10l-7 4-7-4V7l7-4Zm0 0v18M5 7l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  // .fys — skill star
  <path key="skill" d="M12 3l2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 14.8l-4.6 2.5.9-5.2L4.5 8.5l5.2-.8L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  // 浏览器 Agent — globe
  <g key="globe">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" stroke="currentColor" strokeWidth="1.2" />
  </g>,
  // Computer Use — display
  <g key="display">
    <rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 21h6m-3-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </g>,
];

export function Features() {
  const { t } = useLocale();
  return (
    <section id="features" className="mx-auto max-w-7xl px-6 py-28">
      <SectionHead eyebrow={t.features.eyebrow} title={t.features.heading} sub={t.features.sub} />
      <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {t.features.items.map((f, i) => (
          <CardContainer
            key={f.title}
            className="h-72 w-full"
            containerClassName={`py-6 ${i % 3 === 1 ? "lg:mt-10" : ""}`}
          >
            <CardBody className="group/card relative h-full w-auto rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-6 hover:shadow-2xl hover:shadow-jb-purple/10">
              <CardItem
                translateZ={80}
                className="grid size-12 place-items-center rounded-xl border border-white/10 bg-black/60 text-jb-purple"
              >
                <svg viewBox="0 0 24 24" fill="none" className="size-6">
                  {ICONS[i % ICONS.length]}
                </svg>
              </CardItem>
              <CardItem translateZ={60} as="h3" className="mt-5 font-display text-xl font-semibold text-white">
                {f.title}
              </CardItem>
              <CardItem translateZ={40} as="p" className="mt-3 text-sm leading-6 text-white/55">
                {f.description}
              </CardItem>
            </CardBody>
          </CardContainer>
        ))}
      </div>
    </section>
  );
}
