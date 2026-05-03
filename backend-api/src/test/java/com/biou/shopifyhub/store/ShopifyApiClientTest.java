package com.biou.shopifyhub.store;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * T37: ShopifyApiClient 真测试，用 WireMock 拦截 Shopify Admin API。
 * 通过 shopify.api-base-url=http:// 让 client 调本地 WireMock。
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "shopify.api-base-url=http://"
})
class ShopifyApiClientTest {

    static WireMockServer wireMock;

    @Autowired
    ShopifyApiClient client;

    @BeforeAll
    static void setUp() {
        wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().port(0));
        wireMock.start();
    }

    @AfterAll
    static void tearDown() {
        if (wireMock != null) wireMock.stop();
    }

    @Test
    void fetchShopDetail_success() {
        wireMock.resetAll();
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .withHeader("X-Shopify-Access-Token", equalTo("test-token"))
            .willReturn(aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"shop\":{\"name\":\"Test Store\",\"plan_name\":\"basic\",\"domain\":\"test.myshopify.com\"}}")));

        String shopDomain = "localhost:" + wireMock.port();
        ShopifyApiClient.ShopDetail detail = client.fetchShopDetail(shopDomain, "test-token");
        assertTrue(detail.ok());
        assertEquals(200, detail.statusCode());
        assertEquals("Test Store", detail.name());
        assertEquals("basic", detail.planName());
    }

    @Test
    void fetchShopDetail_401_returns_error() {
        wireMock.resetAll();
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .willReturn(aResponse()
                .withStatus(401)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"errors\":\"unauthorized\"}")));

        String shopDomain = "localhost:" + wireMock.port();
        ShopifyApiClient.ShopDetail detail = client.fetchShopDetail(shopDomain, "bad-token");
        assertFalse(detail.ok());
        assertEquals(401, detail.statusCode());
        assertNotNull(detail.error());
        assertTrue(detail.error().contains("401"), "error should contain 401: " + detail.error());
    }

    @Test
    void fetchShopDetail_timeout_returns_error() {
        wireMock.resetAll();
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .willReturn(aResponse()
                .withFixedDelay(15_000) // 超过 client 默认 8s 超时
                .withStatus(200)
                .withBody("{}")));

        String shopDomain = "localhost:" + wireMock.port();
        ShopifyApiClient.ShopDetail detail = client.fetchShopDetail(shopDomain, "test-token");
        assertFalse(detail.ok());
        assertNotNull(detail.error());
    }

    @Test
    void verifyToken_success() {
        wireMock.resetAll();
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .withHeader("X-Shopify-Access-Token", equalTo("good-token"))
            .willReturn(aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"shop\":{\"name\":\"Verified Store\"}}")));

        String shopDomain = "localhost:" + wireMock.port();
        ShopifyApiClient.ShopInfo info = client.verifyToken(shopDomain, "good-token");
        assertTrue(info.ok());
        assertEquals("Verified Store", info.name());
    }

    @Test
    void verifyToken_403_returns_rejected() {
        wireMock.resetAll();
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .willReturn(aResponse().withStatus(403).withBody("{\"errors\":\"forbidden\"}")));

        String shopDomain = "localhost:" + wireMock.port();
        ShopifyApiClient.ShopInfo info = client.verifyToken(shopDomain, "bad-token");
        assertFalse(info.ok());
        assertNotNull(info.error());
        assertTrue(info.error().contains("403"), "error should contain 403: " + info.error());
    }
}
