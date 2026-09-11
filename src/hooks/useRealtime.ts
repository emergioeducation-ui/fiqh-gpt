import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

type TableName =
  | "conversations"
  | "messages"
  | "books"
  | "zakat_settings"
  | "usage_events";

/**
 * Subscribes to database changes and runs a callback, so screens stay
 * up to date without a refresh. One channel per mount, torn down on unmount.
 */
export function useRealtime(
  channelName: string,
  tables: TableName[],
  onChange: () => void,
  options?: { filter?: string; table?: TableName },
) {
  useEffect(() => {
    const channel = supabase.channel(`fiqhgpt-${channelName}-${Math.random().toString(36).slice(2)}`);
    for (const table of tables) {
      const config: { event: "*"; schema: string; table: string; filter?: string } = {
        event: "*",
        schema: "public",
        table,
      };
      if (options?.filter && (!options.table || options.table === table)) {
        config.filter = options.filter;
      }
      channel.on("postgres_changes", config, () => onChange());
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tables.join(","), options?.filter, options?.table]);
}
