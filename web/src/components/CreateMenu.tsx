// "+ Create" in the top bar: a deck, a package or a list, from any page.
import { useState } from "react";
import { NewDeckDialog } from "../pages/NewDeckDialog";
import { NewPackageDialog } from "../pages/NewPackageDialog";
import { CardMenu } from "./CardMenu";

export function CreateMenu() {
  const [creating, setCreating] = useState<"deck" | "package" | "list" | null>(null);
  const close = () => setCreating(null);
  return (
    <>
      <CardMenu
        label="Create a deck, package or list"
        className="create-btn"
        trigger={<span>+ Create <span aria-hidden="true">▾</span></span>}
        sections={[
          {
            items: [
              { label: "Create a deck", onSelect: () => setCreating("deck") },
              { label: "Create a package", onSelect: () => setCreating("package") },
              { label: "Create a list", onSelect: () => setCreating("list") },
            ],
          },
        ]}
      />
      {creating === "deck" && <NewDeckDialog onClose={close} />}
      {creating === "list" && <NewDeckDialog list onClose={close} />}
      {creating === "package" && <NewPackageDialog onClose={close} />}
    </>
  );
}
