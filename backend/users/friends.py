"""Friends: search, requests, an established friendship, and blocking.

Follows the house style used throughout users/views.py: plain dict payloads
(no serializers), `request.user` as the sole actor identity (the other party
always comes from the request body/query by public_id — never trusted from
"who am I" claims), and `{"error": "..."}` on failure.
"""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.throttles import FriendActionRateThrottle, UserSearchRateThrottle
from users.models import BlockedUser, FriendRequest, Friendship

User = get_user_model()

# A search shorter than this matches too much of the user base to be useful
# and is exactly the kind of query worth cutting off before it hits the DB.
MIN_SEARCH_LEN = 2
MAX_RESULTS = 20

DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 100


def _clean_public_id(raw):
    return str(raw or "").strip().lstrip("#")


def _brief(request, user):
    # Inline data URLs (users.views.profile_photo_url) are ~15-35 KB each and are
    # only for the signed-in user's own payload — a list of these (search results,
    # friends/requests/blocked rows) would multiply that across every row and risk
    # blowing the response size limit. List avatars fall back to initials until
    # there's a cacheable photo endpoint; this key stays for client compatibility.
    return {
        "id": user.public_id,
        "username": user.username,
        "points": user.points,
        "rank": user.rank,
        "profile_photo": None,
    }


def _get_target(public_id):
    """Resolve a public_id to a user, or None."""
    if not public_id:
        return None
    return User.objects.filter(public_id__iexact=public_id).first()


def _friend_ids(me):
    """The pks of everyone `me` is friends with.

    Two indexed lookups (one per side of the ordered pair), so this is bounded
    by how many friends `me` actually has, never by the size of the whole
    user base — that's what keeps a friend search/listing cheap at any scale.
    """
    pairs = Friendship.objects.filter(Q(user_low=me) | Q(user_high=me)).values_list(
        "user_low_id", "user_high_id"
    )
    return {hi if lo == me.pk else lo for lo, hi in pairs}


def _relationship_map(me, candidate_ids):
    """Batch-compute each candidate's relationship to `me` in a few queries.

    Returns (relationships, excluded) where `relationships[id]` is
    (status, request_id) and `excluded` is the set of candidate ids blocked
    in either direction (search hides these entirely rather than showing an
    unusable "blocked" row).
    """
    blocked_ids = set(
        BlockedUser.objects.filter(blocker=me, blocked_id__in=candidate_ids).values_list("blocked_id", flat=True)
    )
    blocked_by_ids = set(
        BlockedUser.objects.filter(blocker_id__in=candidate_ids, blocked=me).values_list("blocker_id", flat=True)
    )
    excluded = blocked_ids | blocked_by_ids

    friend_ids = set()
    pairs = Friendship.objects.filter(
        Q(user_low=me, user_high_id__in=candidate_ids) | Q(user_high=me, user_low_id__in=candidate_ids)
    ).values_list("user_low_id", "user_high_id")
    for lo, hi in pairs:
        friend_ids.add(hi if lo == me.pk else lo)

    outgoing = dict(
        FriendRequest.objects.filter(sender=me, receiver_id__in=candidate_ids).values_list("receiver_id", "id")
    )
    incoming = dict(
        FriendRequest.objects.filter(receiver=me, sender_id__in=candidate_ids).values_list("sender_id", "id")
    )

    relationships = {}
    for cid in candidate_ids:
        if cid in excluded:
            continue
        if cid in friend_ids:
            relationships[cid] = ("friend", None)
        elif cid in outgoing:
            relationships[cid] = ("pending_outgoing", outgoing[cid])
        elif cid in incoming:
            relationships[cid] = ("pending_incoming", incoming[cid])
        else:
            relationships[cid] = ("none", None)
    return relationships, excluded


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([UserSearchRateThrottle])
def search_users(request):
    """Find other players by display name or player ID, with the caller's
    current relationship to each (friend / pending / none) — blocked players
    in either direction are omitted rather than shown as unactionable rows."""
    q = _clean_public_id(request.query_params.get("q"))
    if len(q) < MIN_SEARCH_LEN:
        return Response({"results": []})

    me = request.user
    candidates = list(
        User.objects.exclude(pk=me.pk)
        .filter(Q(username__icontains=q) | Q(public_id__icontains=q))
        .only("id", "public_id", "username", "points", "rank")[:MAX_RESULTS]
    )
    relationships, excluded = _relationship_map(me, [u.pk for u in candidates])

    results = []
    for u in candidates:
        if u.pk in excluded:
            continue
        status_, request_id = relationships[u.pk]
        results.append({**_brief(request, u), "relationship": status_, "request_id": request_id})
    return Response({"results": results})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendActionRateThrottle])
def send_friend_request(request):
    """Send a friend request. If the target already sent one to us, accept it
    instead of creating a redundant duplicate the other way."""
    me = request.user
    target = _get_target(_clean_public_id(request.data.get("public_id")))
    if target is None:
        return Response({"error": "No player with that ID."}, status=404)
    if target.pk == me.pk:
        return Response({"error": "You can't add yourself."}, status=400)
    if BlockedUser.objects.filter(Q(blocker=me, blocked=target) | Q(blocker=target, blocked=me)).exists():
        return Response({"error": "You can't send a request to this player."}, status=403)

    lo, hi = Friendship.ordered_pair(me, target)
    if Friendship.objects.filter(user_low=lo, user_high=hi).exists():
        return Response({"error": "You're already friends."}, status=409)

    reverse = FriendRequest.objects.filter(sender=target, receiver=me).first()
    if reverse:
        with transaction.atomic():
            Friendship.objects.get_or_create(user_low=lo, user_high=hi)
            reverse.delete()
        return Response({"status": "accepted"})

    try:
        FriendRequest.objects.create(sender=me, receiver=target)
    except IntegrityError:
        return Response({"error": "Request already sent."}, status=409)
    return Response({"status": "sent"}, status=201)


def _resolve_request(request_id_raw):
    try:
        return int(request_id_raw)
    except (TypeError, ValueError):
        return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def accept_friend_request(request):
    req_id = _resolve_request(request.data.get("request_id"))
    if req_id is None:
        return Response({"error": "request_id is required"}, status=400)
    fr = FriendRequest.objects.filter(pk=req_id, receiver=request.user).first()
    if fr is None:
        return Response({"error": "Request not found."}, status=404)
    lo, hi = Friendship.ordered_pair(fr.sender, fr.receiver)
    with transaction.atomic():
        Friendship.objects.get_or_create(user_low=lo, user_high=hi)
        fr.delete()
    return Response({"status": "accepted"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def decline_friend_request(request):
    req_id = _resolve_request(request.data.get("request_id"))
    if req_id is None:
        return Response({"error": "request_id is required"}, status=400)
    deleted, _ = FriendRequest.objects.filter(pk=req_id, receiver=request.user).delete()
    if not deleted:
        return Response({"error": "Request not found."}, status=404)
    return Response({"status": "declined"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cancel_friend_request(request):
    req_id = _resolve_request(request.data.get("request_id"))
    if req_id is None:
        return Response({"error": "request_id is required"}, status=400)
    deleted, _ = FriendRequest.objects.filter(pk=req_id, sender=request.user).delete()
    if not deleted:
        return Response({"error": "Request not found."}, status=404)
    return Response({"status": "cancelled"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def remove_friend(request):
    me = request.user
    target = _get_target(_clean_public_id(request.data.get("public_id")))
    if target is None:
        return Response({"error": "No player with that ID."}, status=404)
    lo, hi = Friendship.ordered_pair(me, target)
    deleted, _ = Friendship.objects.filter(user_low=lo, user_high=hi).delete()
    if not deleted:
        return Response({"error": "You're not friends with this player."}, status=404)
    return Response({"status": "removed"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendActionRateThrottle])
def block_user(request):
    me = request.user
    target = _get_target(_clean_public_id(request.data.get("public_id")))
    if target is None:
        return Response({"error": "No player with that ID."}, status=404)
    if target.pk == me.pk:
        return Response({"error": "You can't block yourself."}, status=400)

    lo, hi = Friendship.ordered_pair(me, target)
    with transaction.atomic():
        Friendship.objects.filter(user_low=lo, user_high=hi).delete()
        FriendRequest.objects.filter(Q(sender=me, receiver=target) | Q(sender=target, receiver=me)).delete()
        BlockedUser.objects.get_or_create(blocker=me, blocked=target)
    return Response({"status": "blocked"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unblock_user(request):
    target = _get_target(_clean_public_id(request.data.get("public_id")))
    if target is None:
        return Response({"error": "No player with that ID."}, status=404)
    deleted, _ = BlockedUser.objects.filter(blocker=request.user, blocked=target).delete()
    if not deleted:
        return Response({"error": "You haven't blocked this player."}, status=404)
    return Response({"status": "unblocked"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([UserSearchRateThrottle])
def search_friends(request):
    """Page through the caller's own friends, optionally filtered by name or
    player ID typed into a single search box.

    Deliberately two queries rather than one: first resolve *which* users are
    friends (bounded by the caller's own friend count via the indexed
    user_low/user_high columns on Friendship — this never touches the rest of
    the user base), then filter and paginate only that already-small set.
    A search here scales with how many friends you have, not with how many
    players exist on the platform, so it stays fast without needing any
    special text-search index.
    """
    me = request.user
    q = _clean_public_id(request.query_params.get("q"))
    try:
        limit = min(max(int(request.query_params.get("limit", DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)

    friend_ids = _friend_ids(me)
    if not friend_ids:
        return Response({"results": [], "total": 0})

    qs = User.objects.filter(pk__in=friend_ids)
    if q:
        qs = qs.filter(Q(username__icontains=q) | Q(public_id__icontains=q))
    # _brief() never reads profile_photo* (list rows always show initials —
    # see its docstring), so this deliberately leaves the heavy photo blob
    # column off the fetched fields entirely rather than deferring it.
    qs = qs.only("id", "public_id", "username", "points", "rank").order_by("-points", "username")

    total = qs.count()
    page = list(qs[offset : offset + limit])
    return Response({"results": [_brief(request, u) for u in page], "total": total})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def friends_overview(request):
    """Both directions of pending requests, and who you've blocked. The
    friend list itself is paginated separately by `search_friends` — even a
    "give me everyone" call there is still bounded and sorted the same way,
    so there's nothing this endpoint needs to duplicate."""
    me = request.user

    incoming = (
        FriendRequest.objects.filter(receiver=me)
        .select_related("sender")
        .defer("sender__profile_photo_data")
        .order_by("-created_at")
    )
    outgoing = (
        FriendRequest.objects.filter(sender=me)
        .select_related("receiver")
        .defer("receiver__profile_photo_data")
        .order_by("-created_at")
    )
    blocked = (
        BlockedUser.objects.filter(blocker=me)
        .select_related("blocked")
        .defer("blocked__profile_photo_data")
        .order_by("-created_at")
    )

    return Response(
        {
            "incoming_requests": [{"request_id": r.pk, **_brief(request, r.sender)} for r in incoming],
            "outgoing_requests": [{"request_id": r.pk, **_brief(request, r.receiver)} for r in outgoing],
            "blocked_users": [_brief(request, b.blocked) for b in blocked],
        }
    )
