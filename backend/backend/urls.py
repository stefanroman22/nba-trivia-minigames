from django.contrib import admin
from django.urls import path, include

# Add these imports
from django.conf import settings
from django.conf.urls.static import static

from backend.health import health_view
from backend.noindex import robots_txt

urlpatterns = [
    path('robots.txt', robots_txt, name='robots-txt'),
    path('api/health/', health_view, name='health'),
    path('admin/', admin.site.urls),
    path('api/admin/', include('trivia.admin_urls')),
    path('api/', include('users.urls')),
    path('trivia/', include('trivia.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
