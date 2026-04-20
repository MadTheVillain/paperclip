import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, MessageCircle, Plus } from "lucide-react";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";
import { CONFERENCE_ROOM_ORIGIN_KIND } from "@paperclipai/shared";
import { useLocation, useNavigate, useParams, Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IssueChatThread, type IssueChatComposerHandle } from "../components/IssueChatThread";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { conferenceRoomApi } from "../api/conferenceRoom";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { heartbeatsApi } from "../api/heartbeats";
import { activityApi } from "../api/activity";
import { queryKeys } from "../lib/queryKeys";
import {
  createOptimisticIssueComment,
  mergeIssueComments,
  type OptimisticIssueComment,
} from "../lib/optimistic-issue-comments";
import { cn, relativeTime } from "../lib/utils";

const NEW_CHAT_TITLE = "New chat";

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#*_>~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chatDisplayTitle(chat: Issue) {
  if (chat.title && chat.title !== NEW_CHAT_TITLE) return chat.title;
  return chat.identifier ?? NEW_CHAT_TITLE;
}

function ConferenceIconButton({
  label,
  onClick,
  icon,
  active = false,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className="h-8 w-8"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ConferenceRoom() {
  const { chatRef } = useParams<{ chatRef?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const composerRef = useRef<IssueChatComposerHandle | null>(null);
  const [optimisticComments, setOptimisticComments] = useState<OptimisticIssueComment[]>([]);

  const isHistoryRoute = location.pathname.endsWith("/conference/history");
  const isExplicitNewRoute = location.pathname.endsWith("/conference/new");
  const isBaseRoute = !chatRef && !isHistoryRoute && !isExplicitNewRoute;
  const isNewRoute = isExplicitNewRoute || isBaseRoute;

  useEffect(() => {
    setBreadcrumbs([{ label: "Conference Room" }]);
  }, [setBreadcrumbs]);

  const { data: targetState, isLoading: targetLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.conferenceRoom.target(selectedCompanyId) : ["conference-room", "no-company"],
    queryFn: () => conferenceRoomApi.target(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const target = targetState?.target ?? null;
  const targetLabel = targetState?.label ?? "CEO";

  const { data: chats = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.conferenceRoom.chats(selectedCompanyId, target?.id) : ["conference-room", "chats", "no-company"],
    queryFn: () => conferenceRoomApi.chats(selectedCompanyId!, target?.id),
    enabled: !!selectedCompanyId && !!target?.id,
  });

  useEffect(() => {
    if (!selectedCompanyId || targetLoading || !isBaseRoute) return;
    const latestChat = chats[0] ?? null;
    if (latestChat?.identifier || latestChat?.id) {
      navigate(`/conference/${latestChat.identifier ?? latestChat.id}`, { replace: true });
    }
  }, [chats, isBaseRoute, navigate, selectedCompanyId, targetLoading]);

  const { data: issue, isLoading: issueLoading } = useQuery({
    queryKey: chatRef ? queryKeys.issues.detail(chatRef) : ["issues", "detail", "conference-room-new"],
    queryFn: () => issuesApi.get(chatRef!),
    enabled: !!chatRef && !isHistoryRoute && chatRef !== "new",
  });
  const activeIssue =
    issue?.originKind === CONFERENCE_ROOM_ORIGIN_KIND &&
    (!target?.id || issue.originId === target.id)
      ? issue
      : null;
  const issueId = activeIssue?.id ?? null;
  const issueQueryRef = chatRef && chatRef !== "new" && !isHistoryRoute ? chatRef : (issueId ?? "conference-room-new");

  const { data: comments = [] } = useQuery({
    queryKey: issueId ? queryKeys.conferenceRoom.comments(issueQueryRef) : ["conference-room", "comments", "new"],
    queryFn: () => issuesApi.listComments(issueId!, { order: "asc", limit: 200 }),
    enabled: !!issueId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const { data: agents = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "no-company"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);

  const { data: liveRuns = [] } = useQuery({
    queryKey: issueId ? queryKeys.issues.liveRuns(issueQueryRef) : ["issues", "live-runs", "conference-room-new"],
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: issueId ? 3000 : false,
  });
  const { data: activeRun = null } = useQuery({
    queryKey: issueId ? queryKeys.issues.activeRun(issueQueryRef) : ["issues", "active-run", "conference-room-new"],
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: issueId ? 3000 : false,
  });
  const { data: linkedRuns = [] } = useQuery({
    queryKey: issueId ? queryKeys.issues.runs(issueQueryRef) : ["issues", "runs", "conference-room-new"],
    queryFn: () => activityApi.runsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: liveRuns.length > 0 || activeRun ? 5000 : false,
  });

  useEffect(() => {
    if (!issueId) return;
    issuesApi.markRead(issueId).catch(() => undefined);
  }, [issueId]);

  const threadComments = useMemo(
    () => mergeIssueComments(comments, optimisticComments),
    [comments, optimisticComments],
  );

  const invalidateConferenceRoom = useCallback((nextIssueId?: string | null, nextIdentifier?: string | null) => {
    if (selectedCompanyId && target?.id) {
      queryClient.invalidateQueries({ queryKey: queryKeys.conferenceRoom.chats(selectedCompanyId, target.id) });
    }
    const refs = new Set([nextIssueId, nextIdentifier, chatRef, issueId].filter(Boolean) as string[]);
    for (const ref of refs) {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(ref) });
      queryClient.invalidateQueries({ queryKey: queryKeys.conferenceRoom.comments(ref) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(ref) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(ref) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(ref) });
    }
  }, [chatRef, issueId, queryClient, selectedCompanyId, target?.id]);

  const createChat = useMutation({
    mutationFn: (body: string) =>
      conferenceRoomApi.createChat(selectedCompanyId!, {
        targetAgentId: target?.id ?? null,
        initialBody: body,
      }),
    onSuccess: ({ issue: nextIssue, comment }) => {
      queryClient.setQueryData(queryKeys.issues.detail(nextIssue.id), nextIssue);
      if (nextIssue.identifier) {
        queryClient.setQueryData(queryKeys.issues.detail(nextIssue.identifier), nextIssue);
      }
      if (comment) {
        queryClient.setQueryData(queryKeys.conferenceRoom.comments(nextIssue.id), [comment]);
        if (nextIssue.identifier) {
          queryClient.setQueryData(queryKeys.conferenceRoom.comments(nextIssue.identifier), [comment]);
        }
      }
      invalidateConferenceRoom(nextIssue.id, nextIssue.identifier);
      navigate(`/conference/${nextIssue.identifier ?? nextIssue.id}`, { replace: true });
    },
    onError: (err) => {
      pushToast({
        title: "Message failed",
        body: err instanceof Error ? err.message : "Unable to start the chat",
        tone: "error",
      });
    },
  });

  const addComment = useMutation({
    mutationFn: (body: string) =>
      issuesApi.addComment(
        issueId!,
        body,
        activeIssue?.status === "done" || activeIssue?.status === "cancelled" ? true : undefined,
      ),
    onMutate: async (body) => {
      if (!activeIssue) return { optimisticId: null };
      const optimistic = createOptimisticIssueComment({
        companyId: activeIssue.companyId,
        issueId: activeIssue.id,
        body,
        authorUserId: currentUserId,
      });
      setOptimisticComments((current) => [...current, optimistic]);
      return { optimisticId: optimistic.clientId };
    },
    onSuccess: (comment, _body, context) => {
      if (context?.optimisticId) {
        setOptimisticComments((current) => current.filter((entry) => entry.clientId !== context.optimisticId));
      }
      queryClient.setQueryData<IssueComment[]>(queryKeys.conferenceRoom.comments(issueQueryRef), (current) => {
        const existing = current ?? [];
        if (existing.some((entry) => entry.id === comment.id)) return existing;
        return [...existing, comment].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      });
      invalidateConferenceRoom(issueId, activeIssue?.identifier ?? null);
    },
    onError: (err, _body, context) => {
      if (context?.optimisticId) {
        setOptimisticComments((current) => current.filter((entry) => entry.clientId !== context.optimisticId));
      }
      pushToast({
        title: "Message failed",
        body: err instanceof Error ? err.message : "Unable to post the message",
        tone: "error",
      });
    },
    onSettled: () => {
      invalidateConferenceRoom(issueId, activeIssue?.identifier ?? null);
    },
  });

  const stopRun = useMutation({
    mutationFn: (runId: string) => heartbeatsApi.cancel(runId),
    onSuccess: () => invalidateConferenceRoom(issueId),
    onError: (err) => {
      pushToast({
        title: "Stop failed",
        body: err instanceof Error ? err.message : "Unable to stop the current response",
        tone: "error",
      });
    },
  });

  const handleAdd = useCallback(async (body: string) => {
    if (!selectedCompanyId || !target?.id) throw new Error("Conference Room target is unavailable");
    if (!issueId) {
      await createChat.mutateAsync(body);
      return;
    }
    await addComment.mutateAsync(body);
  }, [addComment, createChat, issueId, selectedCompanyId, target?.id]);

  const openHistory = useCallback(() => navigate("/conference/history"), [navigate]);
  const openNewChat = useCallback(() => navigate("/conference/new"), [navigate]);

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">Select a company.</div>;
  }

  if (targetLoading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!target) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center">
        <div className="max-w-sm text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">No CEO Found</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add a CEO agent before opening the Conference Room.</p>
        </div>
      </div>
    );
  }

  const showChat = !isHistoryRoute;
  const chatIsMissing = !!chatRef && chatRef !== "new" && !issueLoading && !activeIssue;

  return (
    <TooltipProvider>
      <div className="flex min-h-[calc(100vh-8.5rem)] w-full max-w-5xl flex-col">
        <div className="mb-3 flex h-11 shrink-0 items-center justify-between border-b border-border/80 bg-background">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/60">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{targetLabel}</div>
              <div className="truncate text-xs text-muted-foreground">{target.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ConferenceIconButton
              label="Chat history"
              onClick={openHistory}
              active={isHistoryRoute}
              icon={<History className="h-4 w-4" />}
            />
            <ConferenceIconButton
              label="New chat"
              onClick={openNewChat}
              active={isNewRoute && !isHistoryRoute}
              icon={<Plus className="h-4 w-4" />}
            />
          </div>
        </div>

        {isHistoryRoute ? (
          <div className="flex-1">
            <div className="divide-y divide-border">
              {chats.length === 0 ? (
                <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
                  No chats yet.
                </div>
              ) : (
                chats.map((chat) => {
                  const excerpt = stripMarkdown(chat.latestComment?.body ?? "");
                  const to = `/conference/${chat.identifier ?? chat.id}`;
                  return (
                    <Link
                      key={chat.id}
                      to={to}
                      className="block px-1 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{chatDisplayTitle(chat)}</div>
                          {excerpt ? (
                            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{excerpt}</div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(chat.lastActivityAt ?? chat.updatedAt)}
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        ) : chatIsMissing ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Chat not found.
          </div>
        ) : showChat ? (
          <div className={cn("flex-1", issueLoading && "opacity-70")}>
            <IssueChatThread
              composerRef={composerRef}
              comments={threadComments}
              linkedRuns={linkedRuns.map((run) => ({
                ...run,
                hasStoredOutput: (run.logBytes ?? 0) > 0,
              }))}
              liveRuns={liveRuns}
              activeRun={activeRun}
              companyId={selectedCompanyId}
              projectId={activeIssue?.projectId ?? null}
              issueStatus={activeIssue?.status ?? "todo"}
              agentMap={agentMap as Map<string, Agent>}
              currentUserId={currentUserId}
              draftKey={`conference-room:${issueId ?? "new"}:${target.id}`}
              enableReassign={false}
              mentions={[{ id: target.id, name: target.name, kind: "agent", agentId: target.id, agentIcon: target.icon }]}
              onAdd={handleAdd}
              onStopRun={(runId) => stopRun.mutateAsync(runId)}
              onCancelRun={activeRun?.id ? () => stopRun.mutateAsync(activeRun.id) : undefined}
              emptyMessage={isNewRoute ? "" : "No messages yet."}
              showJumpToLatest
            />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
