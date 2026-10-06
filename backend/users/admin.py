from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserCreationForm
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from . import strikes
from .models import BlockedUser, CustomUser, FriendRequest, Friendship, ModerationEvent

# Hide the JWT token_blacklist sections from the admin sidebar. The app itself
# stays installed and enforced (SIMPLE_JWT rotation/blacklist in settings.py) —
# this only removes the admin UI clutter, not the security behavior.
# token_blacklist's own admin.py may not have run yet at this point (INSTALLED_APPS
# order), so the models might not be registered — that's fine, nothing to hide then.
for _model in (OutstandingToken, BlacklistedToken):
    try:
        admin.site.unregister(_model)
    except admin.sites.NotRegistered:
        pass


class CustomUserCreationForm(UserCreationForm):
    """Holds the admin's add-user form to the case-insensitive email identity.

    The unique index on email is case-sensitive, so the stock form would create
    "Foo@Bar.com" alongside an existing "foo@bar.com" — two rows that are the
    same login. Same normalization and duplicate check as users.views.signup_view.
    """

    def clean_email(self):
        email = CustomUser.objects.normalize_login_email(self.cleaned_data.get("email"))
        if email and CustomUser.objects.filter(email__iexact=email).exists():
            raise ValidationError(self.instance.unique_error_message(CustomUser, ["email"]))
        return email


_EVENT_FIELDS = ('created_at', 'kind', 'tier', 'reason', 'public_id', 'ip_hash')


class ModerationEventInline(admin.TabularInline):
    """Read-only history of a user's moderation events (no matched text is ever stored)."""
    model = ModerationEvent
    fields = _EVENT_FIELDS
    readonly_fields = _EVENT_FIELDS
    ordering = ('-created_at',)
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    model = CustomUser
    add_form = CustomUserCreationForm
    list_display = ('username', 'email', 'is_staff', 'is_active', 'rank', 'points', 'strike_count', 'banned_at')
    list_filter = ('is_staff', 'is_active', 'rank', ('banned_at', admin.EmptyFieldListFilter))

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('email', 'points', 'rank')}),
        ('Permissions', {'fields': ('is_staff', 'is_active', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
        # Read-only: a ban goes through users.strikes (blacklists tokens, hides the player);
        # the "Unban (reset strikes)" action is the only way back.
        ('Moderation', {'fields': ('strike_count', 'banned_at', 'ban_reason', 'canonical_email')}),
    )
    readonly_fields = ('strike_count', 'banned_at', 'ban_reason', 'canonical_email')
    inlines = [ModerationEventInline]
    actions = ['unban_users']

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'points', 'rank', 'is_staff', 'is_active')}
        ),
    )
    search_fields = ('username', 'email')
    ordering = ('username',)

    def get_inlines(self, request, obj):
        # The event history belongs to an existing account; the add form has none.
        return self.inlines if obj is not None else []

    @admin.action(description="Unban (reset strikes)")
    def unban_users(self, request, queryset):
        count = 0
        for user in queryset:
            if user.banned_at or user.strike_count:
                strikes.unban_user(user)
                count += 1
        self.message_user(request, f"Unbanned / reset {count} account(s).")


@admin.register(ModerationEvent)
class ModerationEventAdmin(admin.ModelAdmin):
    """Read-only log for the owner's review."""
    list_display = ('created_at', 'public_id', 'kind', 'tier', 'reason')
    list_filter = ('kind', 'tier', 'reason')
    search_fields = ('public_id',)
    readonly_fields = ('user',) + _EVENT_FIELDS

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(FriendRequest)
class FriendRequestAdmin(admin.ModelAdmin):
    list_display = ('sender', 'receiver', 'created_at')
    search_fields = ('sender__username', 'sender__public_id', 'receiver__username', 'receiver__public_id')
    autocomplete_fields = ('sender', 'receiver')


@admin.register(Friendship)
class FriendshipAdmin(admin.ModelAdmin):
    list_display = ('user_low', 'user_high', 'created_at')
    search_fields = ('user_low__username', 'user_low__public_id', 'user_high__username', 'user_high__public_id')
    autocomplete_fields = ('user_low', 'user_high')


@admin.register(BlockedUser)
class BlockedUserAdmin(admin.ModelAdmin):
    list_display = ('blocker', 'blocked', 'created_at')
    search_fields = ('blocker__username', 'blocker__public_id', 'blocked__username', 'blocked__public_id')
    autocomplete_fields = ('blocker', 'blocked')
