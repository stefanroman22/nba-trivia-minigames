from django.urls import path
from .views import (
    login_view,
    get_current_user,
    update_profile,
    logout_view,
    signup_view,
    google_login,
    get_users,
    export_my_data,
    delete_my_account,
    check_name,
)
from .friends import (
    search_users,
    search_friends,
    send_friend_request,
    accept_friend_request,
    decline_friend_request,
    cancel_friend_request,
    remove_friend,
    block_user,
    unblock_user,
    friends_overview,
)
from .photos import profile_photo_view
from .tokens import SessionRefreshView

urlpatterns = [
    path('login/', login_view, name='login'),
    path('signup/', signup_view, name='signup'),
    path('me/', get_current_user, name='get_user'),
    path('update-profile/', update_profile, name='update'),
    path('account/export/', export_my_data, name='account_export'),
    path('account/delete/', delete_my_account, name='account_delete'),
    path('logout/', logout_view, name='logout'),
    path('login/google/', google_login, name='google_login'),
    path('get-users/', get_users, name='get-users'),
    # Live, throttled username moderation check for the signup/profile forms (never strikes).
    path('check-name/', check_name, name='check-name'),
    # Rotating refresh with an absolute 90-day session cap (see users.tokens).
    path('token/refresh/', SessionRefreshView.as_view(), name='token_refresh'),

    # Friends
    path('search-users/', search_users, name='search-users'),
    path('search-friends/', search_friends, name='search-friends'),
    path('send-friend-request/', send_friend_request, name='send-friend-request'),
    path('accept-friend-request/', accept_friend_request, name='accept-friend-request'),
    path('decline-friend-request/', decline_friend_request, name='decline-friend-request'),
    path('cancel-friend-request/', cancel_friend_request, name='cancel-friend-request'),
    path('remove-friend/', remove_friend, name='remove-friend'),
    path('block-user/', block_user, name='block-user'),
    path('unblock-user/', unblock_user, name='unblock-user'),
    path('friends-overview/', friends_overview, name='friends-overview'),

    # Public, cacheable profile photo for list rows (bytes only; see users.photos).
    path('users/<str:public_id>/photo/', profile_photo_view, name='profile-photo'),
]
