from django.urls import path
from .views import login_view, get_current_user, update_profile, logout_view, signup_view, google_login, get_users


urlpatterns = [
    path('login/', login_view, name='login'),
    path('signup/', signup_view, name='signup'),
    path('me/', get_current_user, name='get_user'),
    path('update-profile/', update_profile, name='update'),
    path('logout/', logout_view, name='logout'),
    path('login/google/', google_login, name='google_login'),
    path('get-users/', get_users, name='get-users'),

]