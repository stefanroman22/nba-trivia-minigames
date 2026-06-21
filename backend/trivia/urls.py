from django.urls import path
from .views import (
    get_random_playoff_series,
    get_random_nba_teams,
    get_mvps,
    get_starting_five,
    get_wordle,
    get_manifest,
    get_pool,
)
from trivia.dynamic_data.players import get_all_players

urlpatterns = [
    path('playoff-series/', get_random_playoff_series, name='playoff-series'),
    path('name-logo/', get_random_nba_teams, name='name-logo'),
    path('guess-mvps/', get_mvps, name='guess-mvp'),
    path('all-players/', get_all_players, name='all-players'),
    path('starting-five/', get_starting_five, name='starting-five'),
    path('wordle/', get_wordle, name='wordle'),
    path('manifest/', get_manifest, name='manifest'),
    path('pool/<str:game>/', get_pool, name='pool'),
]
