import Link from "next/link";

export default function NotFound() {
  return (
    <article className="screen paper">
      <h1>This page does not exist</h1>
      <p>The address may be mistyped, or the page may have moved. <Link href="/">Go back to the observatory</Link>.</p>
    </article>
  );
}
