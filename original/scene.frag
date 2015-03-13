#version 130

in vec2 UV;
in vec3 fragmentNormal;
in vec2 fragmentPosition;

// Ouput data
out vec3 color;

uniform sampler2D diffuse1;
uniform sampler2D diffuse2;

uniform sampler2D texture;

uniform vec3 drawColor;

uniform vec3 lightPos1;
uniform vec3 lightPos2;


void main()
{
    vec3 light1 = texture2D(diffuse1, UV).rgb;
    vec3 light2 = texture2D(diffuse2, UV).rgb;

    vec3  d1 = vec3(fragmentPosition,0) - (lightPos1 * 0.0008);
    float a1 = 1 / (1 + 3 * (d1.x * d1.x + d1.y * d1.y));
    float s1 = a1 * clamp(dot(normalize(d1), normalize(-1 * fragmentNormal)), 0, 1);

    vec3  d2 = vec3(fragmentPosition,0) - (lightPos2 * 0.0008);
    float a2 = 1 / (1 + 3 * (d2.x * d2.x + d2.y * d2.y));
    float s2 = a2 * clamp(dot(normalize(d2), normalize(-1 * fragmentNormal)), 0, 1);

    vec3 diffuse = s1 * light1 + s2 * light2;
    vec3 ambient = vec3(0.02, 0.02, 0.05);
    vec3 lighting = diffuse + ambient;

    if (drawColor == vec3(0,0,0)) {
        color = lighting * texture2D(texture, UV * 20).rgb;
    } else {
        color = lighting * drawColor.rgb;
    }
}
