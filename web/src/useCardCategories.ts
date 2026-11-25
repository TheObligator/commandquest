import { useEffect, useState } from "react";
import { CARD_CATEGORIES_VERSION, CardCategories, type CardCategoriesData } from "./cardCategories";

let loading: Promise<CardCategories> | undefined;

/** Loads the list once per page; a failed load is retried next time. */
function load(): Promise<CardCategories> {
  loading ??= fetch(`${import.meta.env.BASE_URL}card-categories.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`card-categories.json: HTTP ${r.status}`);
      return r.json() as Promise<CardCategoriesData>;
    })
    .then((d) => {
      if (d.version !== CARD_CATEGORIES_VERSION) throw new Error("card-categories.json is another version's");
      return new CardCategories(d);
    })
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}

/** The automatic categories once `wanted`: undefined while they load, null when they couldn't be loaded. */
export function useCardCategories(wanted: boolean): CardCategories | null | undefined {
  const [categories, setCategories] = useState<CardCategories | null>();
  useEffect(() => {
    if (!wanted || categories) return;
    let gone = false;
    load().then(
      (c) => !gone && setCategories(c),
      () => !gone && setCategories(null),
    );
    return () => void (gone = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return categories;
}
