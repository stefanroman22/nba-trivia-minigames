from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from .models import CustomUser

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

@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    model = CustomUser
    list_display = ('username', 'email', 'is_staff', 'is_active', 'rank', 'points')
    list_filter = ('is_staff', 'is_active', 'rank')

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('email', 'points', 'rank', 'profile_photo')}),
        ('Permissions', {'fields': ('is_staff', 'is_active', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'points', 'rank', 'profile_photo', 'is_staff', 'is_active')}
        ),
    )
    search_fields = ('username', 'email')
    ordering = ('username',)
