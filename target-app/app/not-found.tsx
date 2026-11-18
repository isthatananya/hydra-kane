import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel">
      <h1>Not found</h1>
      <p>That order does not exist.</p>
      <Link href="/">Back to the store</Link>
    </section>
  );
}
