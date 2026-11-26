import type { Metadata } from "next";
import { HuntView } from "@/components/hunt-view";
import { SitePage } from "@/components/site";
import { getLibrary } from "@/lib/data";
import { SHOPS } from "@/lib/shops";

export const metadata: Metadata = { title: "Live Kane hunt" };

export default async function HuntPage({ params }: PageProps<"/hunts/[id]">) {
  const { id } = await params;
  const library = await getLibrary();
  // Shipped for every shop; which one this hunt hit stays hidden until the API reveals it.
  const bugs = Object.fromEntries(
    SHOPS.map((s) => {
      const b = library.find((x) => x.id === s.bug);
      return [s.bug, { title: b?.title ?? s.bug, description: b?.description ?? "", run: s.run }];
    }),
  );
  return (
    <SitePage>
      <HuntView id={id} bugs={bugs} />
    </SitePage>
  );
}
