"use client";
import { useId, useState } from "react";
import { Badge, Button } from "@reviewrouter/ui";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { HistoryPullRequest } from "@reviewrouter/features-review-history/contracts";
import {
  historyInstant,
  historyStatusLabels,
  historyStatusTone,
} from "../application/history-presentation";
import { HistoryRuns } from "./history-runs";
import styles from "./history.module.css";

export function HistoryRow({
  row,
  refresh,
}: {
  row: HistoryPullRequest;
  refresh: number;
}) {
  const [open, setOpen] = useState(false);
  const historyId = useId();
  const title =
    row.pullRequestTitle || `Pull request #${row.pullRequestNumber}`;
  return (
    <li className={styles.row}>
      <div className={styles.rowSummary}>
        <div className={styles.identity}>
          {row.pullRequestUrl ? (
            <a
              className={styles.prLink}
              href={row.pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {title}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : (
            <span className={styles.prTitle}>{title}</span>
          )}
          <p className={styles.metadata}>
            <span>{row.repositoryFullName}</span>
            <span>#{row.pullRequestNumber}</span>
          </p>
        </div>
        <div className={styles.rowState}>
          <Badge
            size="xs"
            className={styles.statusBadge}
            tone={historyStatusTone(row.status)}
          >
            {historyStatusLabels[row.status]}
          </Badge>
          <time dateTime={row.requestedAt}>
            Requested {historyInstant(row.requestedAt)}
          </time>
        </div>
        <Button
          className={styles.disclosure}
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={historyId}
          aria-label={`${open ? "Hide" : "Show"} review history for ${row.repositoryFullName} #${row.pullRequestNumber}`}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={open ? styles.expandedIcon : undefined}
          />
          Review history
        </Button>
      </div>
      <div id={historyId} hidden={!open} className={styles.history}>
        {open ? <HistoryRuns pullRequestId={row.id} refresh={refresh} /> : null}
      </div>
    </li>
  );
}
