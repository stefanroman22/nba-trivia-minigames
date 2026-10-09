"""Keep the API host out of search engines: it serves JSON for the site, never pages for people.

robots.txt rules only apply to the host that serves them, so this host needs its own (`Disallow: /`),
and a crawler that fetches a URL anyway is told not to index it (`X-Robots-Tag: noindex`).
"""
from django.http import HttpResponse

ROBOTS_TXT = "User-agent: *\nDisallow: /\n"


def robots_txt(request):
    return HttpResponse(ROBOTS_TXT, content_type="text/plain; charset=utf-8")


class NoIndexMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response
