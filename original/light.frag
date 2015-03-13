#version 130

in vec2 fragPos;

// Ouput data
out vec3 color;

uniform vec3 lightPos;
uniform vec3 lightColor;

void main()
{
    vec2 d = fragPos - (lightPos.xy * 0.0008);
//  float s = dot(normalize(vec3(d,lightHeight)), vec3(0,0,1));
	color = lightColor;
}
