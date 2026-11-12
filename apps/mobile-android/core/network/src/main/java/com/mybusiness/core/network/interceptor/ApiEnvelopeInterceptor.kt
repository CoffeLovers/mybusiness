package com.mybusiness.core.network.interceptor

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ApiEnvelopeInterceptor @Inject constructor(
    private val json: Json
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)

        if (!response.isSuccessful) {
            return response
        }

        val body = response.body ?: return response
        val contentType = body.contentType()

        val isJson = contentType?.subtype?.contains("json", ignoreCase = true) == true
        if (!isJson) {
            return response
        }

        val rawJson = try {
            body.string()
        } catch (e: Exception) {
            Timber.w(e, "Error al leer ResponseBody en ApiEnvelopeInterceptor")
            return response
        }

        return try {
            val jsonElement = json.parseToJsonElement(rawJson)
            if (jsonElement is JsonObject) {
                val isSuccess = jsonElement["success"]?.jsonPrimitive?.booleanOrNull == true
                val hasData = jsonElement.containsKey("data")

                if (isSuccess && hasData) {
                    val dataElement = jsonElement["data"]
                    val unwrappedData = dataElement?.toString() ?: "null"
                    response.newBuilder()
                        .body(unwrappedData.toResponseBody(contentType))
                        .build()
                } else {
                    response.newBuilder()
                        .body(rawJson.toResponseBody(contentType))
                        .build()
                }
            } else {
                response.newBuilder()
                    .body(rawJson.toResponseBody(contentType))
                    .build()
            }
        } catch (e: Exception) {
            Timber.w(e, "Error desempaquetando envelope del API Gateway, devolviendo JSON original")
            response.newBuilder()
                .body(rawJson.toResponseBody(contentType))
                .build()
        }
    }
}
