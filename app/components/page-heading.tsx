import BackNavigation from "./back-navigation";

export default function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-hero"><div className="page-shell">
    <BackNavigation current={eyebrow} />
    <p className="kicker">{eyebrow}</p>
    <h1 className="page-title">{title}</h1>
    <p>{description}</p>
  </div></section>;
}
