from django.test import TestCase


class ApiHostNoIndexTests(TestCase):
    def test_robots_txt_disallows_everything(self):
        resp = self.client.get("/robots.txt")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content.decode(), "User-agent: *\nDisallow: /\n")

    def test_every_response_carries_noindex(self):
        for path in ("/api/health/", "/api/get-users/", "/robots.txt", "/does-not-exist/"):
            self.assertEqual(self.client.get(path)["X-Robots-Tag"], "noindex, nofollow", path)
