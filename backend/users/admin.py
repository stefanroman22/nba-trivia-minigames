from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserCreationForm
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from .models import BlockedUser, CustomUser, FriendRequest, Friendship

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


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    model = CustomUser
    add_form = CustomUserCreationForm
    list_display = ('username', 'email', 'is_staff', 'is_active', 'rank', 'points')
    list_filter = ('is_staff', 'is_active', 'rank')

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('email', 'points', 'rank')}),
        ('Permissions', {'fields': ('is_staff', 'is_active', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'points', 'rank', 'is_staff', 'is_active')}
        ),
    )
    search_fields = ('username', 'email')
    ordering = ('username',)


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
