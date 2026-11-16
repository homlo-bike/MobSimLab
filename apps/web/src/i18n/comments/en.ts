/**
 * English messages of the comments on project objects (apps/web/src/features/comments). Merged into each
 * language's dictionary like the editor messages; every language has its own file next to this one.
 */
export const commentsEn = {
  "comments.title": "Comments",
  "comments.none": "No comments yet.",
  "comments.new": "Write a comment…",
  "comments.post": "Comment",
  "comments.reply": "Reply",
  "comments.replyLabel": "Write a reply…",
  "comments.resolve": "Resolve",
  "comments.reopen": "Reopen",
  "comments.resolvedBy": "Resolved by {name}",
  "comments.hideResolved": "Hide resolved threads",
  "comments.showResolved.one": "Show {count} resolved thread",
  "comments.showResolved.other": "Show {count} resolved threads",
  "comments.openThreads.one": "{count} open comment thread",
  "comments.openThreads.other": "{count} open comment threads",
  "comments.edit": "Edit",
  "comments.editLabel": "Edit your comment",
  "comments.edited": "edited",
  "comments.save": "Save",
  "comments.cancel": "Cancel",
  "comments.delete": "Delete",
  "comments.confirmDelete": "Delete this comment?",
  "comments.confirmDeleteThread": "Delete this comment and all replies to it?",
  "comments.someone": "Someone",
  "comments.failed": "Comments could not be loaded or saved: {error}",
  "comments.readOnly": "Viewers can read comments but not write them.",
  "comments.panelIntro":
    "Comments on the stations, tracks, lines and depots of this project. Pick an object to read its comments or start one.",
  "comments.noObjects": "Nothing has been drawn in this project yet.",
  "comments.openList": "Open threads",
  "comments.noOpen": "No open threads.",
  "comments.object": "Object",
  "comments.choose": "Choose an object…",
  "comments.switchN": "Switch {id}",
  "comments.signalN": "Signal {id}",
  "comments.group.station": "Stations",
  "comments.group.track": "Tracks",
  "comments.group.switch": "Switches",
  "comments.group.signal": "Signals",
  "comments.group.service-line": "Rail service lines",
  "comments.group.street-line": "Street lines",
  "comments.group.depot": "Depots",
};

/** A language's comment messages: every key of the English ones. */
export type CommentsMessages = Record<keyof typeof commentsEn, string>;
