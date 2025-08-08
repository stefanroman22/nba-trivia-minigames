from django.urls import path
from .views import get_random_playoff_series

urlpatterns = [
    path('playoff-series/', get_random_playoff_series, name='playoff-series'),
]